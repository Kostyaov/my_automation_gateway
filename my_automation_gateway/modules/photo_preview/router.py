from __future__ import annotations

import asyncio
import shutil
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException, WebSocket
from fastapi import WebSocketDisconnect

from .models import FolderOpenRequest, PhotoPreviewJobRequest
from .service import MANIFEST_NAME, PREVIEW_FOLDER_NAME
from .service import PhotoPreviewError, PreviewOptions, PreviewPlan, PreviewTask
from .service import build_preview_plan, manifest_key, manifest_record, options_from_request
from .service import pillow_available, public_task_path, render_preview, save_manifest


router = APIRouter(tags=["photo-preview"])

photo_preview_jobs: dict[str, dict[str, Any]] = {}
photo_preview_event_history: dict[str, list[dict[str, Any]]] = {}
photo_preview_event_queues: dict[str, set[asyncio.Queue]] = {}
photo_preview_semaphore = asyncio.Semaphore(1)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def public_photo_preview_job(job: dict[str, Any]) -> dict[str, Any]:
    hidden = {"tasks", "manifests", "options"}
    return {key: value for key, value in job.items() if key not in hidden}


async def publish_photo_preview_event(job_id: str, event_type: str, data: dict[str, Any]) -> None:
    event = {
        "type": event_type,
        "data": data,
        "timestamp": utc_now(),
    }
    history = photo_preview_event_history.setdefault(job_id, [])
    history.append(event)
    del history[:-500]

    for queue in list(photo_preview_event_queues.get(job_id, set())):
        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:
            pass


async def run_desktop_command(command: list[str]) -> tuple[int, str, str]:
    try:
        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Could not run {command[0]} because it is not available",
        ) from exc

    return (
        process.returncode,
        stdout.decode(errors="replace").strip(),
        stderr.decode(errors="replace").strip(),
    )


def folder_picker_command(title: str, initial_directory: Path) -> list[str]:
    if sys.platform == "darwin":
        script = f'POSIX path of (choose folder with prompt "{title}" default location POSIX file "{initial_directory}")'
        return ["osascript", "-e", script]

    if sys.platform.startswith("win"):
        selected_path = str(initial_directory).replace("'", "''")
        script = (
            "Add-Type -AssemblyName System.Windows.Forms; "
            "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog; "
            f"$dialog.Description = '{title}'; "
            f"$dialog.SelectedPath = '{selected_path}'; "
            "$dialog.ShowNewFolderButton = $false; "
            "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) "
            "{ [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Write-Output $dialog.SelectedPath; exit 0 } "
            "exit 2"
        )
        return ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script]

    if shutil.which("zenity"):
        return ["zenity", "--file-selection", "--directory", f"--title={title}", f"--filename={initial_directory}/"]
    if shutil.which("kdialog"):
        return ["kdialog", "--getexistingdirectory", str(initial_directory), "--title", title]

    raise HTTPException(status_code=500, detail="Install zenity or kdialog to choose folders on Linux")


def initial_photo_directory() -> Path:
    for candidate in (Path.home() / "Pictures", Path.home() / "Desktop", Path.home()):
        if candidate.exists() and candidate.is_dir():
            return candidate.resolve()
    return Path.home().resolve()


async def open_local_folder(path: Path, label: str) -> dict[str, str]:
    if not path.exists() or not path.is_dir():
        raise HTTPException(status_code=400, detail=f"{label} does not exist")

    if sys.platform == "darwin":
        command = ["open", str(path)]
    elif sys.platform.startswith("win"):
        command = ["explorer", str(path)]
    else:
        command = ["xdg-open", str(path)]

    returncode, stdout, stderr = await run_desktop_command(command)
    if returncode != 0:
        raise HTTPException(status_code=500, detail=stderr or stdout or f"Could not open {label}")

    return {"status": "opened", "path": str(path)}


def response_for_folder_picker(returncode: int, stdout: str, stderr: str, label: str) -> dict[str, str]:
    if returncode != 0:
        message = stderr or stdout
        if returncode in {1, 2} or "cancel" in message.lower():
            raise HTTPException(status_code=400, detail="Folder selection cancelled")
        raise HTTPException(status_code=500, detail=message or f"Could not choose {label}")

    if not stdout:
        raise HTTPException(status_code=400, detail="Folder selection cancelled")

    path = Path(stdout).expanduser().resolve()
    if not path.exists() or not path.is_dir():
        raise HTTPException(status_code=400, detail="Selected folder does not exist")

    return {"status": "selected", "path": str(path)}


def job_stats_from_plan(plan: PreviewPlan) -> dict[str, Any]:
    return {
        "source_count": plan.source_count,
        "pending_count": len(plan.tasks),
        "created_count": 0,
        "planned_count": 0,
        "skipped_count": len(plan.skipped),
        "failed_count": 0,
        "original_bytes": plan.original_bytes,
        "preview_bytes": 0,
    }


async def mark_photo_preview_job_cancelled(
    job_id: str,
    message: str = "Photo preview job cancelled.",
) -> None:
    job = photo_preview_jobs[job_id]
    job["status"] = "cancelled"
    job["finished_at"] = utc_now()
    job["error"] = message
    await publish_photo_preview_event(job_id, "status", {"status": "cancelled"})
    await publish_photo_preview_event(
        job_id,
        "cancelled",
        {"status": "cancelled", "message": message, "stats": job["stats"]},
    )


async def save_dirty_manifests(job_id: str, dirty_dirs: set[Path]) -> None:
    job = photo_preview_jobs[job_id]
    manifests: dict[Path, dict[str, Any]] = job["manifests"]
    for preview_dir in sorted(dirty_dirs, key=lambda path: str(path).casefold()):
        try:
            await asyncio.to_thread(save_manifest, preview_dir, manifests[preview_dir])
        except OSError as exc:
            job["stats"]["failed_count"] += 1
            await publish_photo_preview_event(
                job_id,
                "log",
                {
                    "message": (
                        "[ERROR] Could not update "
                        + str(preview_dir / MANIFEST_NAME)
                        + f": {exc}"
                    )
                },
            )


async def run_photo_preview_job(job_id: str) -> None:
    job = photo_preview_jobs[job_id]
    options: PreviewOptions = job["options"]
    tasks: list[PreviewTask] = job["tasks"]
    manifests: dict[Path, dict[str, Any]] = job["manifests"]
    dirty_manifest_dirs: set[Path] = set()

    async with photo_preview_semaphore:
        if job.get("cancel_requested"):
            await mark_photo_preview_job_cancelled(job_id)
            return

        job["status"] = "running"
        job["started_at"] = utc_now()
        await publish_photo_preview_event(job_id, "status", {"status": "running"})
        await publish_photo_preview_event(
            job_id,
            "log",
            {
                "message": (
                    f"Scanning done. Found {job['stats']['source_count']} JPEG file(s), "
                    f"{len(tasks)} pending, {job['stats']['skipped_count']} skipped."
                )
            },
        )

        if options.dry_run:
            job["stats"]["planned_count"] = len(tasks)
            job["status"] = "finished"
            job["finished_at"] = utc_now()
            await publish_photo_preview_event(job_id, "progress", {"stats": job["stats"]})
            await publish_photo_preview_event(
                job_id,
                "finished",
                {
                    "status": "finished",
                    "message": f"Check finished. Would create {len(tasks)} preview file(s).",
                    "stats": job["stats"],
                },
            )
            return

        if not tasks:
            job["status"] = "finished"
            job["finished_at"] = utc_now()
            await publish_photo_preview_event(
                job_id,
                "finished",
                {
                    "status": "finished",
                    "message": "No preview files needed.",
                    "stats": job["stats"],
                },
            )
            return

        queue: asyncio.Queue[PreviewTask] = asyncio.Queue()
        for task in tasks:
            queue.put_nowait(task)

        total_pending = len(tasks)
        worker_count = min(options.workers, total_pending)
        await publish_photo_preview_event(
            job_id,
            "log",
            {"message": f"Rendering previews with {worker_count} worker(s)."},
        )

        async def worker() -> None:
            while not queue.empty():
                if job.get("cancel_requested"):
                    return

                try:
                    task = queue.get_nowait()
                except asyncio.QueueEmpty:
                    return

                try:
                    result = await asyncio.to_thread(render_preview, task, options)
                except Exception as exc:
                    job["stats"]["failed_count"] += 1
                    await publish_photo_preview_event(
                        job_id,
                        "log",
                        {
                            "message": (
                                "[ERROR] "
                                + public_task_path(task.source_path, options.source_dir)
                                + f": {exc}"
                            )
                        },
                    )
                else:
                    manifest = manifests.setdefault(task.preview_dir, {"items": {}})
                    manifest.setdefault("items", {})[manifest_key(task.source_path)] = manifest_record(
                        task,
                        result,
                        options,
                    )
                    dirty_manifest_dirs.add(task.preview_dir)
                    job["stats"]["created_count"] += 1
                    job["stats"]["preview_bytes"] += result.preview_size

                completed = job["stats"]["created_count"] + job["stats"]["failed_count"]
                if completed <= 20 or completed % 25 == 0 or completed == total_pending:
                    await publish_photo_preview_event(
                        job_id,
                        "log",
                        {
                            "message": (
                                f"[PROGRESS] {completed}/{total_pending} processed, "
                                f"{job['stats']['created_count']} created, "
                                f"{job['stats']['failed_count']} failed."
                            )
                        },
                    )
                await publish_photo_preview_event(job_id, "progress", {"stats": job["stats"]})
                queue.task_done()

        workers = [asyncio.create_task(worker()) for _ in range(worker_count)]
        await asyncio.gather(*workers)
        await save_dirty_manifests(job_id, dirty_manifest_dirs)

        if job.get("cancel_requested"):
            await mark_photo_preview_job_cancelled(job_id)
            return

        job["finished_at"] = utc_now()
        failed_count = job["stats"]["failed_count"]
        created_count = job["stats"]["created_count"]
        job["status"] = "finished"
        message = f"Finished. Created {created_count} preview file(s)."
        if failed_count:
            message += f" {failed_count} file(s) failed."
        await publish_photo_preview_event(job_id, "status", {"status": "finished"})
        await publish_photo_preview_event(
            job_id,
            "finished",
            {"status": "finished", "message": message, "stats": job["stats"]},
        )


@router.get("/config")
async def photo_preview_config() -> dict[str, Any]:
    return {
        "has_pillow": pillow_available(),
        "preview_folder_name": PREVIEW_FOLDER_NAME,
        "supported_formats": ["jpeg", "webp"],
        "defaults": {
            "output_format": "jpeg",
            "max_side": 1920,
            "quality": 90,
            "name_filter": "camera",
            "skip_unchanged": True,
            "workers": 4,
        },
    }


@router.post("/select-source-folder")
async def select_photo_preview_source_folder() -> dict[str, str]:
    command = folder_picker_command("Choose photo archive folder", initial_photo_directory())
    returncode, stdout, stderr = await run_desktop_command(command)
    return response_for_folder_picker(returncode, stdout, stderr, "photo archive folder")


@router.post("/open-folder")
async def open_photo_preview_folder(request: FolderOpenRequest) -> dict[str, str]:
    if not request.path or not request.path.strip():
        raise HTTPException(status_code=400, detail="path is required")
    path = Path(request.path).expanduser().resolve()
    return await open_local_folder(path, "folder")


@router.post("/jobs")
async def create_photo_preview_job(
    request: PhotoPreviewJobRequest,
    background_tasks: BackgroundTasks,
) -> dict[str, Any]:
    try:
        options = options_from_request(request)
        if not options.dry_run and not pillow_available():
            raise PhotoPreviewError("Pillow is not installed. Run pip install -r requirements.txt")
        plan = build_preview_plan(options)
    except PhotoPreviewError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    job_id = uuid.uuid4().hex[:12]
    job = {
        "id": job_id,
        "provider": "photo_preview",
        "status": "queued",
        "source_path": str(options.source_dir),
        "preview_folder_name": options.preview_folder_name,
        "output_format": options.output_format,
        "max_side": options.max_side,
        "quality": options.quality,
        "name_filter": options.name_filter,
        "skip_unchanged": options.skip_unchanged,
        "dry_run": options.dry_run,
        "workers": options.workers,
        "created_at": utc_now(),
        "started_at": None,
        "finished_at": None,
        "error": None,
        "cancel_requested": False,
        "stats": job_stats_from_plan(plan),
        "tasks": plan.tasks,
        "manifests": plan.manifests,
        "options": options,
    }
    photo_preview_jobs[job_id] = job
    await publish_photo_preview_event(job_id, "status", {"status": "queued"})
    await publish_photo_preview_event(job_id, "log", {"message": "Queued Photo Preview job."})
    background_tasks.add_task(run_photo_preview_job, job_id)
    return {"status": "accepted", "job": public_photo_preview_job(job)}


@router.get("/jobs/{job_id}")
async def get_photo_preview_job(job_id: str) -> dict[str, Any]:
    job = photo_preview_jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        "job": public_photo_preview_job(job),
        "events": photo_preview_event_history.get(job_id, []),
    }


@router.post("/jobs/{job_id}/cancel")
async def cancel_photo_preview_job(job_id: str) -> dict[str, Any]:
    job = photo_preview_jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.get("status") in {"finished", "failed", "cancelled"}:
        return {"status": job["status"], "job": public_photo_preview_job(job)}

    job["cancel_requested"] = True
    if job.get("status") == "queued":
        await publish_photo_preview_event(
            job_id,
            "log",
            {"message": "[CANCEL] Photo Preview job cancelled before start."},
        )
        await mark_photo_preview_job_cancelled(job_id)
        return {"status": "cancelled", "job": public_photo_preview_job(job)}

    job["status"] = "cancelling"
    await publish_photo_preview_event(job_id, "status", {"status": "cancelling"})
    await publish_photo_preview_event(job_id, "log", {"message": "[CANCEL] Stopping Photo Preview job..."})
    return {"status": "cancelling", "job": public_photo_preview_job(job)}


@router.websocket("/jobs/{job_id}/events")
async def photo_preview_job_events(websocket: WebSocket, job_id: str):
    await websocket.accept()
    queue: asyncio.Queue = asyncio.Queue(maxsize=100)
    photo_preview_event_queues.setdefault(job_id, set()).add(queue)
    try:
        for event in photo_preview_event_history.get(job_id, []):
            await websocket.send_json(event)
        while True:
            event = await queue.get()
            await websocket.send_json(event)
    except WebSocketDisconnect:
        pass
    finally:
        queues = photo_preview_event_queues.get(job_id)
        if queues:
            queues.discard(queue)
