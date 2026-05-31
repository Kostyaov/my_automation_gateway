import asyncio
import json
import logging
import mimetypes
import os
import re
import shutil
import shlex
import unicodedata
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Request, WebSocket
from fastapi import WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
from pydantic import BaseModel, Field

from elevenlabs_transcription import build_segments_from_elevenlabs
from elevenlabs_transcription import create_elevenlabs_transcript
from elevenlabs_transcription import fetch_elevenlabs_subscription
from elevenlabs_transcription import DEFAULT_MODEL_ID, ElevenLabsTranscriptionError
from transcript_subtitles import export_csv, export_srt, export_txt, export_vtt
from transcript_subtitles import parse_transcript, renumber_segments


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)

app = FastAPI(title="Local Automation Gateway")

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

FRONTENDS_DIR = ROOT / "frontends"
TRANSCRIPT_DATA_DIR = ROOT / "data" / "projects"
FFMPEG_DATA_DIR = ROOT / "data" / "ffmpeg"
FFMPEG_INPUT_DIR = FFMPEG_DATA_DIR / "inputs"
FFMPEG_OUTPUT_DIR = FFMPEG_DATA_DIR / "outputs"
ELEVENLABS_DATA_DIR = ROOT / "data" / "elevenlabs"
ELEVENLABS_INPUT_DIR = ELEVENLABS_DATA_DIR / "inputs"
ELEVENLABS_OUTPUT_DIR = ELEVENLABS_DATA_DIR / "outputs"
TRANSCRIPT_DATA_DIR.mkdir(parents=True, exist_ok=True)
FFMPEG_INPUT_DIR.mkdir(parents=True, exist_ok=True)
FFMPEG_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
ELEVENLABS_INPUT_DIR.mkdir(parents=True, exist_ok=True)
ELEVENLABS_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

whisper_semaphore = asyncio.Semaphore(1)
ffmpeg_semaphore = asyncio.Semaphore(1)
elevenlabs_semaphore = asyncio.Semaphore(1)


class WhisperRequest(BaseModel):
    file_path: str


class FFmpegRequest(BaseModel):
    file_path: str
    output_path: str


class FFmpegJobRequest(BaseModel):
    operation: str = Field(min_length=1)
    inputs: dict[str, str] = Field(default_factory=dict)
    output_path: str | None = None
    options: dict[str, Any] = Field(default_factory=dict)


class ElevenLabsJobRequest(BaseModel):
    file_path: str = Field(min_length=1)
    model_id: str = DEFAULT_MODEL_ID
    language_code: str | None = None
    tag_audio_events: bool = False
    diarize: bool = True
    no_verbatim: bool = True
    num_speakers: int | None = Field(default=None, ge=1, le=32)
    timestamps_granularity: str = "word"
    enable_logging: bool = True
    temperature: float | None = Field(default=None, ge=0, le=2)
    create_project: bool = True


class ProjectCreate(BaseModel):
    audio_filename: str = Field(min_length=1)
    audio_type: str | None = None
    transcript_filename: str = Field(min_length=1)
    transcript_text: str = Field(min_length=1)


class PlaybackState(BaseModel):
    current_time: float = 0
    selected_id: int | None = None


class ProjectUpdate(BaseModel):
    segments: list[dict[str, Any]]
    playback_state: PlaybackState | None = None


ffmpeg_jobs: dict[str, dict[str, Any]] = {}
ffmpeg_event_history: dict[str, list[dict[str, Any]]] = {}
ffmpeg_event_queues: dict[str, set[asyncio.Queue]] = {}
elevenlabs_jobs: dict[str, dict[str, Any]] = {}
elevenlabs_event_history: dict[str, list[dict[str, Any]]] = {}
elevenlabs_event_queues: dict[str, set[asyncio.Queue]] = {}

VIDEO_EXTENSIONS = {".mp4", ".mkv", ".mov", ".avi", ".webm", ".m4v"}
AUDIO_EXTENSIONS = {".mp3", ".m4a", ".wav", ".aac", ".flac", ".ogg", ".opus"}
SUBTITLE_EXTENSIONS = {".srt", ".vtt", ".ass"}
MEDIA_EXTENSIONS = VIDEO_EXTENSIONS | AUDIO_EXTENSIONS | SUBTITLE_EXTENSIONS


async def run_shell_command(command: str, task_name: str) -> None:
    process = await asyncio.create_subprocess_shell(
        command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await process.communicate()

    if stdout:
        logging.info("%s stdout:\n%s", task_name, stdout.decode(errors="replace").strip())
    if stderr:
        logging.warning("%s stderr:\n%s", task_name, stderr.decode(errors="replace").strip())

    if process.returncode == 0:
        logging.info("%s finished successfully", task_name)
    else:
        logging.error("%s failed with exit code %s", task_name, process.returncode)


async def run_whisper_worker(file_path: str) -> None:
    async with whisper_semaphore:
        logging.info("Starting whisper task for %s", file_path)
        command = f"whisper {shlex.quote(file_path)} --threads 4 --model base"
        await run_shell_command(command, "whisper")


async def run_ffmpeg_worker(file_path: str, output_path: str) -> None:
    async with ffmpeg_semaphore:
        logging.info("Starting ffmpeg task for %s -> %s", file_path, output_path)
        command = (
            f"ffmpeg -i {shlex.quote(file_path)} "
            f"-threads 2 -c:v libx264 {shlex.quote(output_path)} -y"
        )
        await run_shell_command(command, "ffmpeg")


def transcript_project_dir(project_id: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{12}", project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    directory = TRANSCRIPT_DATA_DIR / project_id
    if not directory.exists():
        raise HTTPException(status_code=404, detail="Project not found")
    return directory


def transcript_metadata_path(project_id: str) -> Path:
    return transcript_project_dir(project_id) / "project.json"


def read_transcript_project(project_id: str) -> dict[str, Any]:
    path = transcript_metadata_path(project_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Project not found")
    return json.loads(path.read_text(encoding="utf-8"))


def write_transcript_project(project: dict[str, Any]) -> None:
    project["updated_at"] = datetime.now(timezone.utc).isoformat()
    path = transcript_metadata_path(project["id"])
    path.write_text(json.dumps(project, ensure_ascii=False, indent=2), encoding="utf-8")


def safe_filename(filename: str) -> str:
    name = unicodedata.normalize("NFC", Path(unquote(filename)).name.strip() or "audio")
    return re.sub(r"[^\w._ -]+", "_", name, flags=re.UNICODE)


def display_filename(filename: str | None) -> str | None:
    if not filename:
        return filename
    filename = unicodedata.normalize("NFC", filename)
    if re.search(r"_[0-9A-Fa-f]{2}", filename):
        decoded = unquote(re.sub(r"_([0-9A-Fa-f]{2})", r"%\1", filename))
        return decoded or filename
    return filename


def attachment_headers(filename: str) -> dict[str, str]:
    ascii_name = re.sub(r"[^A-Za-z0-9._-]+", "_", filename) or "transcript.txt"
    return {
        "Content-Disposition": (
            f"attachment; filename={ascii_name}; filename*=UTF-8''{quote(filename)}"
        )
    }


def ffmpeg_scan_dirs() -> list[Path]:
    candidates = [
        Path.home() / "Downloads",
        FFMPEG_OUTPUT_DIR,
        FFMPEG_INPUT_DIR,
    ]
    return [path for path in candidates if path.exists()]


def elevenlabs_scan_dirs() -> list[Path]:
    candidates = [
        Path.home() / "Downloads",
        ELEVENLABS_INPUT_DIR,
        ELEVENLABS_OUTPUT_DIR,
        FFMPEG_OUTPUT_DIR,
        FFMPEG_INPUT_DIR,
    ]
    return [path for path in candidates if path.exists()]


def media_kind(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in VIDEO_EXTENSIONS:
        return "video"
    if suffix in AUDIO_EXTENSIONS:
        return "audio"
    if suffix in SUBTITLE_EXTENSIONS:
        return "subtitle"
    return "other"


def list_media_files() -> list[dict[str, Any]]:
    files: list[dict[str, Any]] = []
    seen: set[Path] = set()
    for directory in ffmpeg_scan_dirs():
        for path in directory.iterdir():
            if not path.is_file() or path.name.startswith("."):
                continue
            if path.suffix.lower() not in MEDIA_EXTENSIONS:
                continue
            resolved = path.resolve()
            if resolved in seen:
                continue
            seen.add(resolved)
            stat = path.stat()
            files.append(
                {
                    "name": path.name,
                    "path": str(resolved),
                    "kind": media_kind(path),
                    "size": stat.st_size,
                    "modified_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
                    "source": str(directory),
                }
            )
    return sorted(files, key=lambda item: item["modified_at"], reverse=True)


def list_elevenlabs_files() -> list[dict[str, Any]]:
    files: list[dict[str, Any]] = []
    seen: set[Path] = set()
    allowed_extensions = VIDEO_EXTENSIONS | AUDIO_EXTENSIONS
    for directory in elevenlabs_scan_dirs():
        for path in directory.iterdir():
            if not path.is_file() or path.name.startswith("."):
                continue
            if path.suffix.lower() not in allowed_extensions:
                continue
            resolved = path.resolve()
            if resolved in seen:
                continue
            seen.add(resolved)
            files.append(ffmpeg_file_payload(path, directory))
    return sorted(files, key=lambda item: item["modified_at"], reverse=True)


def ffmpeg_file_payload(path: Path, source: Path | None = None) -> dict[str, Any]:
    stat = path.stat()
    return {
        "name": path.name,
        "path": str(path.resolve()),
        "kind": media_kind(path),
        "size": stat.st_size,
        "modified_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
        "source": str(source or path.parent),
    }


def unique_media_path(directory: Path, filename: str) -> Path:
    path = directory / filename
    if not path.exists():
        return path

    stem = path.stem
    suffix = path.suffix
    for index in range(1, 1000):
        candidate = directory / f"{stem}-{index}{suffix}"
        if not candidate.exists():
            return candidate

    return directory / f"{stem}-{uuid.uuid4().hex[:8]}{suffix}"


def resolve_media_path(value: str, field_name: str) -> Path:
    if not value or not value.strip():
        raise HTTPException(status_code=400, detail=f"{field_name} is required")

    candidate = Path(value).expanduser()
    if not candidate.is_absolute() and candidate.exists() and candidate.is_file():
        return candidate.resolve()
    if not candidate.is_absolute() and (ROOT / candidate).exists() and (ROOT / candidate).is_file():
        return (ROOT / candidate).resolve()
    if candidate.is_absolute() and candidate.exists() and candidate.is_file():
        return candidate.resolve()

    for directory in ffmpeg_scan_dirs():
        path = directory / value
        if path.exists() and path.is_file():
            return path.resolve()

    raise HTTPException(status_code=400, detail=f"{field_name} file not found")


def resolve_output_path(output_path: str | None, default_name: str) -> Path:
    if output_path and output_path.strip():
        candidate = Path(output_path).expanduser()
        if not candidate.is_absolute():
            candidate = FFMPEG_OUTPUT_DIR / candidate
    else:
        candidate = FFMPEG_OUTPUT_DIR / default_name

    candidate.parent.mkdir(parents=True, exist_ok=True)
    return candidate.resolve()


def output_name(input_path: Path, suffix: str, extension: str | None = None) -> str:
    ext = extension or input_path.suffix or ".mp4"
    return f"{input_path.stem}_{suffix}{ext}"


def ffmpeg_option_bool(options: dict[str, Any], key: str, default: bool) -> bool:
    value = options.get(key, default)
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.lower() in {"1", "true", "yes", "on"}
    return bool(value)


def ffmpeg_option_str(options: dict[str, Any], key: str, default: str) -> str:
    value = str(options.get(key, default)).strip()
    return value or default


def build_replace_audio_command(payload: FFmpegJobRequest) -> tuple[list[str], Path]:
    video = resolve_media_path(payload.inputs.get("video", ""), "video")
    audio = resolve_media_path(payload.inputs.get("audio", ""), "audio")
    output = resolve_output_path(payload.output_path, output_name(video, "audio_replaced", ".mp4"))
    audio_codec = ffmpeg_option_str(payload.options, "audio_codec", "aac")
    command = [
        "ffmpeg",
        "-y",
        "-i",
        str(video),
        "-i",
        str(audio),
        "-threads",
        "2",
        "-c:v",
        "copy",
        "-c:a",
        audio_codec,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
    ]
    if ffmpeg_option_bool(payload.options, "shortest", True):
        command.append("-shortest")
    command.append(str(output))
    return command, output


def build_extract_audio_command(payload: FFmpegJobRequest) -> tuple[list[str], Path]:
    source = resolve_media_path(payload.inputs.get("input", ""), "input")
    audio_format = ffmpeg_option_str(payload.options, "format", "mp3").lower().lstrip(".")
    extension = f".{audio_format}"
    output = resolve_output_path(payload.output_path, output_name(source, "audio", extension))
    codec_by_format = {
        "mp3": ["-c:a", "libmp3lame", "-b:a", "192k"],
        "wav": ["-c:a", "pcm_s16le"],
        "m4a": ["-c:a", "aac", "-b:a", "192k"],
        "aac": ["-c:a", "aac", "-b:a", "192k"],
        "ogg": ["-c:a", "libvorbis", "-q:a", "4"],
    }
    codec_args = codec_by_format.get(audio_format, codec_by_format["mp3"])
    command = ["ffmpeg", "-y", "-i", str(source), "-threads", "2", "-vn", *codec_args, str(output)]
    return command, output


def build_cut_media_command(payload: FFmpegJobRequest) -> tuple[list[str], Path]:
    source = resolve_media_path(payload.inputs.get("input", ""), "input")
    start_time = ffmpeg_option_str(payload.options, "start_time", "00:00:00")
    stop_time = ffmpeg_option_str(payload.options, "stop_time", "")
    output = resolve_output_path(payload.output_path, output_name(source, "cut"))
    command = ["ffmpeg", "-y", "-ss", start_time]
    if stop_time:
        command.extend(["-to", stop_time])
    command.extend(["-i", str(source)])
    if ffmpeg_option_bool(payload.options, "copy", True):
        command.extend(["-c", "copy"])
    else:
        command.extend(["-threads", "2", "-c:v", "libx264", "-c:a", "aac"])
    command.append(str(output))
    return command, output


def build_convert_mp4_command(payload: FFmpegJobRequest) -> tuple[list[str], Path]:
    source = resolve_media_path(payload.inputs.get("input", ""), "input")
    output = resolve_output_path(payload.output_path, output_name(source, "converted", ".mp4"))
    crf = ffmpeg_option_str(payload.options, "crf", "23")
    preset = ffmpeg_option_str(payload.options, "preset", "medium")
    command = [
        "ffmpeg",
        "-y",
        "-i",
        str(source),
        "-threads",
        "2",
        "-c:v",
        "libx264",
        "-preset",
        preset,
        "-crf",
        crf,
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        str(output),
    ]
    return command, output


def build_compress_video_command(payload: FFmpegJobRequest) -> tuple[list[str], Path]:
    source = resolve_media_path(payload.inputs.get("input", ""), "input")
    output = resolve_output_path(payload.output_path, output_name(source, "compressed", ".mp4"))
    crf = ffmpeg_option_str(payload.options, "crf", "28")
    preset = ffmpeg_option_str(payload.options, "preset", "slow")
    command = [
        "ffmpeg",
        "-y",
        "-i",
        str(source),
        "-threads",
        "2",
        "-c:v",
        "libx264",
        "-preset",
        preset,
        "-crf",
        crf,
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        str(output),
    ]
    return command, output


def build_remove_audio_command(payload: FFmpegJobRequest) -> tuple[list[str], Path]:
    source = resolve_media_path(payload.inputs.get("input", ""), "input")
    output = resolve_output_path(payload.output_path, output_name(source, "no_audio", ".mp4"))
    command = ["ffmpeg", "-y", "-i", str(source), "-c:v", "copy", "-an", str(output)]
    return command, output


def build_remux_mp4_command(payload: FFmpegJobRequest) -> tuple[list[str], Path]:
    source = resolve_media_path(payload.inputs.get("input", ""), "input")
    output = resolve_output_path(payload.output_path, output_name(source, "remuxed", ".mp4"))
    command = ["ffmpeg", "-y", "-i", str(source), "-c", "copy", str(output)]
    return command, output


FFMPEG_OPERATIONS = {
    "replace_audio": build_replace_audio_command,
    "extract_audio": build_extract_audio_command,
    "cut_media": build_cut_media_command,
    "convert_mp4": build_convert_mp4_command,
    "compress_video": build_compress_video_command,
    "remove_audio": build_remove_audio_command,
    "remux_mp4": build_remux_mp4_command,
}


def build_ffmpeg_command(payload: FFmpegJobRequest) -> tuple[list[str], Path]:
    builder = FFMPEG_OPERATIONS.get(payload.operation)
    if builder is None:
        raise HTTPException(status_code=400, detail=f"Unsupported operation: {payload.operation}")
    return builder(payload)


async def publish_ffmpeg_event(job_id: str, event_type: str, data: dict[str, Any]) -> None:
    event = {
        "type": event_type,
        "data": data,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    history = ffmpeg_event_history.setdefault(job_id, [])
    history.append(event)
    del history[:-500]

    for queue in list(ffmpeg_event_queues.get(job_id, set())):
        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:
            pass


async def read_ffmpeg_stream(job_id: str, stream: asyncio.StreamReader, label: str) -> None:
    while True:
        line = await stream.readline()
        if not line:
            break
        text = line.decode(errors="replace").rstrip()
        if text:
            await publish_ffmpeg_event(job_id, "log", {"stream": label, "message": text})


async def run_ffmpeg_job(job_id: str) -> None:
    job = ffmpeg_jobs[job_id]
    command = job["command"]
    output_path = Path(job["output_path"])

    async with ffmpeg_semaphore:
        job["status"] = "running"
        job["started_at"] = datetime.now(timezone.utc).isoformat()
        await publish_ffmpeg_event(job_id, "status", {"status": "running"})
        await publish_ffmpeg_event(job_id, "log", {"message": "Running: " + shlex.join(command)})

        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        job["pid"] = process.pid
        await asyncio.gather(
            read_ffmpeg_stream(job_id, process.stdout, "stdout"),
            read_ffmpeg_stream(job_id, process.stderr, "stderr"),
        )
        return_code = await process.wait()

        job["return_code"] = return_code
        job["finished_at"] = datetime.now(timezone.utc).isoformat()
        if return_code == 0:
            job["status"] = "finished"
            await publish_ffmpeg_event(
                job_id,
                "finished",
                {
                    "status": "finished",
                    "output_path": str(output_path),
                    "message": f"Finished: {output_path.name}",
                },
            )
        else:
            job["status"] = "failed"
            await publish_ffmpeg_event(
                job_id,
                "error",
                {
                    "status": "failed",
                    "return_code": return_code,
                    "message": f"FFmpeg failed with exit code {return_code}",
                },
            )


def elevenlabs_api_key() -> str:
    return os.getenv("ELEVENLABS_API_KEY", "").strip()


async def publish_elevenlabs_event(job_id: str, event_type: str, data: dict[str, Any]) -> None:
    event = {
        "type": event_type,
        "data": data,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    history = elevenlabs_event_history.setdefault(job_id, [])
    history.append(event)
    del history[:-500]

    for queue in list(elevenlabs_event_queues.get(job_id, set())):
        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:
            pass


def elevenlabs_output_stem(source_path: Path, job_id: str) -> Path:
    return ELEVENLABS_OUTPUT_DIR / f"{source_path.stem}_{job_id}"


def create_transcript_project_from_segments(
    *,
    source_path: Path,
    segments: list[dict[str, Any]],
    raw_response_path: Path,
) -> dict[str, Any]:
    project_id = uuid.uuid4().hex[:12]
    directory = TRANSCRIPT_DATA_DIR / project_id
    audio_dir = directory / "audio"
    audio_dir.mkdir(parents=True)

    audio_filename = safe_filename(source_path.name)
    target_audio = unique_media_path(audio_dir, audio_filename)
    shutil.copy2(source_path, target_audio)

    project = {
        "id": project_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "audio_filename": target_audio.name,
        "audio_type": mimetypes.guess_type(target_audio.name)[0] or "application/octet-stream",
        "audio_path": str(target_audio.relative_to(directory)),
        "transcript_filename": f"{source_path.stem}.elevenlabs.json",
        "segments": renumber_segments(segments),
        "playback_state": {"current_time": 0, "selected_id": 1 if segments else None},
        "source": {
            "provider": "elevenlabs",
            "raw_response_path": str(raw_response_path),
        },
    }
    write_transcript_project(project)
    return project


async def run_elevenlabs_job(job_id: str) -> None:
    job = elevenlabs_jobs[job_id]
    request_options = job["request_options"]
    source_path = Path(job["file_path"])
    api_key = elevenlabs_api_key()

    async with elevenlabs_semaphore:
        job["status"] = "running"
        job["started_at"] = datetime.now(timezone.utc).isoformat()
        await publish_elevenlabs_event(job_id, "status", {"status": "running"})
        await publish_elevenlabs_event(
            job_id,
            "log",
            {"message": f"Uploading to ElevenLabs: {source_path.name}"},
        )

        try:
            payload = await create_elevenlabs_transcript(
                api_key=api_key,
                file_path=source_path,
                **request_options,
            )
            segments = build_segments_from_elevenlabs(payload)
            output_stem = elevenlabs_output_stem(source_path, job_id)
            raw_response_path = output_stem.with_suffix(".json")
            srt_path = output_stem.with_suffix(".srt")
            vtt_path = output_stem.with_suffix(".vtt")
            txt_path = output_stem.with_suffix(".txt")

            raw_response_path.write_text(
                json.dumps(
                    {
                        "provider": "elevenlabs",
                        "job_id": job_id,
                        "source_file": str(source_path),
                        "request_options": request_options,
                        "response": payload,
                        "segments": segments,
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            srt_path.write_text(export_srt(segments), encoding="utf-8")
            vtt_path.write_text(export_vtt(segments), encoding="utf-8")
            txt_path.write_text(export_txt(segments), encoding="utf-8")

            project = None
            if job["create_project"]:
                await publish_elevenlabs_event(
                    job_id,
                    "log",
                    {"message": "Creating Transcript Editor project"},
                )
                project = create_transcript_project_from_segments(
                    source_path=source_path,
                    segments=segments,
                    raw_response_path=raw_response_path,
                )
                job["project_id"] = project["id"]

            job.update(
                {
                    "status": "finished",
                    "finished_at": datetime.now(timezone.utc).isoformat(),
                    "segment_count": len(segments),
                    "raw_response_path": str(raw_response_path),
                    "srt_path": str(srt_path),
                    "vtt_path": str(vtt_path),
                    "txt_path": str(txt_path),
                }
            )
            await publish_elevenlabs_event(
                job_id,
                "finished",
                {
                    "status": "finished",
                    "message": f"Finished transcription: {len(segments)} segments",
                    "segment_count": len(segments),
                    "project_id": project["id"] if project else None,
                    "exports": {
                        "json": f"/api/elevenlabs/jobs/{job_id}/export/json",
                        "srt": f"/api/elevenlabs/jobs/{job_id}/export/srt",
                        "vtt": f"/api/elevenlabs/jobs/{job_id}/export/vtt",
                        "txt": f"/api/elevenlabs/jobs/{job_id}/export/txt",
                    },
                },
            )
        except ElevenLabsTranscriptionError as exc:
            job["status"] = "failed"
            job["finished_at"] = datetime.now(timezone.utc).isoformat()
            job["error"] = str(exc)
            await publish_elevenlabs_event(
                job_id,
                "error",
                {"status": "failed", "message": str(exc)},
            )
        except Exception as exc:
            logging.exception("ElevenLabs job failed")
            job["status"] = "failed"
            job["finished_at"] = datetime.now(timezone.utc).isoformat()
            job["error"] = str(exc)
            await publish_elevenlabs_event(
                job_id,
                "error",
                {"status": "failed", "message": f"ElevenLabs job failed: {exc}"},
            )


@app.post("/api/whisper")
async def start_whisper(request: WhisperRequest, background_tasks: BackgroundTasks):
    background_tasks.add_task(run_whisper_worker, request.file_path)
    return {"status": "accepted", "task": "whisper"}


@app.post("/api/ffmpeg")
async def start_ffmpeg(request: FFmpegRequest, background_tasks: BackgroundTasks):
    if not request.output_path.strip():
        raise HTTPException(status_code=400, detail="output_path is required")

    output_parent = Path(request.output_path).expanduser().parent
    if str(output_parent) and not output_parent.exists():
        raise HTTPException(status_code=400, detail="output_path directory does not exist")

    background_tasks.add_task(
        run_ffmpeg_worker,
        request.file_path,
        request.output_path,
    )
    return {"status": "accepted", "task": "ffmpeg"}


@app.get("/api/ffmpeg/operations")
async def list_ffmpeg_operations() -> dict[str, list[str]]:
    return {"operations": sorted(FFMPEG_OPERATIONS)}


@app.get("/api/ffmpeg/files")
async def list_ffmpeg_files() -> dict[str, Any]:
    return {
        "scan_dirs": [str(path) for path in ffmpeg_scan_dirs()],
        "output_dir": str(FFMPEG_OUTPUT_DIR),
        "files": list_media_files(),
    }


@app.post("/api/ffmpeg/uploads")
async def upload_ffmpeg_file(
    request: Request,
    x_filename: str | None = Header(default=None),
) -> dict[str, Any]:
    filename = safe_filename(x_filename or "media")
    suffix = Path(filename).suffix.lower()
    if suffix not in MEDIA_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported media extension: {suffix or 'none'}",
        )

    target = unique_media_path(FFMPEG_INPUT_DIR, filename)
    total_bytes = 0
    try:
        with target.open("wb") as buffer:
            async for chunk in request.stream():
                total_bytes += len(chunk)
                buffer.write(chunk)
    except Exception:
        if target.exists():
            target.unlink()
        raise

    if total_bytes == 0:
        if target.exists():
            target.unlink()
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    return {"status": "uploaded", "file": ffmpeg_file_payload(target, FFMPEG_INPUT_DIR)}


@app.post("/api/ffmpeg/jobs")
async def create_ffmpeg_job(
    request: FFmpegJobRequest,
    background_tasks: BackgroundTasks,
) -> dict[str, Any]:
    command, output_path = build_ffmpeg_command(request)
    job_id = uuid.uuid4().hex[:12]
    job = {
        "id": job_id,
        "operation": request.operation,
        "status": "queued",
        "command": command,
        "command_text": shlex.join(command),
        "output_path": str(output_path),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "started_at": None,
        "finished_at": None,
        "return_code": None,
    }
    ffmpeg_jobs[job_id] = job
    await publish_ffmpeg_event(job_id, "status", {"status": "queued"})
    await publish_ffmpeg_event(job_id, "log", {"message": f"Queued {request.operation}"})
    background_tasks.add_task(run_ffmpeg_job, job_id)
    return {
        "status": "accepted",
        "job": {key: value for key, value in job.items() if key != "command"},
    }


@app.get("/api/ffmpeg/jobs/{job_id}")
async def get_ffmpeg_job(job_id: str) -> dict[str, Any]:
    job = ffmpeg_jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        "job": {key: value for key, value in job.items() if key != "command"},
        "events": ffmpeg_event_history.get(job_id, []),
    }


@app.websocket("/api/ffmpeg/jobs/{job_id}/events")
async def ffmpeg_job_events(websocket: WebSocket, job_id: str):
    await websocket.accept()
    queue: asyncio.Queue = asyncio.Queue(maxsize=100)
    ffmpeg_event_queues.setdefault(job_id, set()).add(queue)
    try:
        for event in ffmpeg_event_history.get(job_id, []):
            await websocket.send_json(event)
        while True:
            event = await queue.get()
            await websocket.send_json(event)
    except WebSocketDisconnect:
        pass
    finally:
        queues = ffmpeg_event_queues.get(job_id)
        if queues:
            queues.discard(queue)


def public_elevenlabs_job(job: dict[str, Any]) -> dict[str, Any]:
    hidden = {"request_options"}
    return {key: value for key, value in job.items() if key not in hidden}


def public_elevenlabs_subscription(payload: dict[str, Any]) -> dict[str, Any]:
    used = int_or_none(payload.get("character_count"))
    limit = int_or_none(payload.get("character_limit"))
    remaining = None
    used_percent = None

    if used is not None and limit is not None:
        remaining = max(0, limit - used)
        used_percent = round(min(100.0, max(0.0, (used / limit) * 100)), 1) if limit > 0 else None

    return {
        "tier": payload.get("tier"),
        "status": payload.get("status"),
        "character_count": used,
        "character_limit": limit,
        "remaining": remaining,
        "used_percent": used_percent,
        "currency": payload.get("currency"),
        "billing_period": payload.get("billing_period"),
        "character_refresh_period": payload.get("character_refresh_period"),
        "next_character_count_reset_unix": payload.get("next_character_count_reset_unix"),
        "max_credit_limit_extension": payload.get("max_credit_limit_extension"),
        "current_overage": payload.get("current_overage"),
        "has_open_invoices": payload.get("has_open_invoices"),
    }


def int_or_none(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


@app.get("/api/elevenlabs/config")
async def elevenlabs_config() -> dict[str, Any]:
    return {
        "has_api_key": bool(elevenlabs_api_key()),
        "default_model_id": DEFAULT_MODEL_ID,
        "input_dir": str(ELEVENLABS_INPUT_DIR),
        "output_dir": str(ELEVENLABS_OUTPUT_DIR),
        "supported_extensions": sorted(VIDEO_EXTENSIONS | AUDIO_EXTENSIONS),
    }


@app.get("/api/elevenlabs/subscription")
async def elevenlabs_subscription() -> dict[str, Any]:
    api_key = elevenlabs_api_key()
    if not api_key:
        raise HTTPException(status_code=400, detail="ELEVENLABS_API_KEY is not configured")

    try:
        payload = await fetch_elevenlabs_subscription(api_key)
    except ElevenLabsTranscriptionError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return public_elevenlabs_subscription(payload)


@app.get("/api/elevenlabs/files")
async def list_elevenlabs_media_files() -> dict[str, Any]:
    return {
        "scan_dirs": [str(path) for path in elevenlabs_scan_dirs()],
        "input_dir": str(ELEVENLABS_INPUT_DIR),
        "output_dir": str(ELEVENLABS_OUTPUT_DIR),
        "files": list_elevenlabs_files(),
    }


@app.post("/api/elevenlabs/uploads")
async def upload_elevenlabs_file(
    request: Request,
    x_filename: str | None = Header(default=None),
) -> dict[str, Any]:
    filename = safe_filename(x_filename or "media")
    suffix = Path(filename).suffix.lower()
    if suffix not in (VIDEO_EXTENSIONS | AUDIO_EXTENSIONS):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported media extension: {suffix or 'none'}",
        )

    target = unique_media_path(ELEVENLABS_INPUT_DIR, filename)
    total_bytes = 0
    try:
        with target.open("wb") as buffer:
            async for chunk in request.stream():
                total_bytes += len(chunk)
                buffer.write(chunk)
    except Exception:
        if target.exists():
            target.unlink()
        raise

    if total_bytes == 0:
        if target.exists():
            target.unlink()
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    return {"status": "uploaded", "file": ffmpeg_file_payload(target, ELEVENLABS_INPUT_DIR)}


@app.post("/api/elevenlabs/jobs")
async def create_elevenlabs_job(
    request: ElevenLabsJobRequest,
    background_tasks: BackgroundTasks,
) -> dict[str, Any]:
    if not elevenlabs_api_key():
        raise HTTPException(status_code=400, detail="ELEVENLABS_API_KEY is not configured")
    if request.timestamps_granularity not in {"word", "character"}:
        raise HTTPException(status_code=400, detail="timestamps_granularity must be word or character")

    source_path = resolve_media_path(request.file_path, "file_path")
    if source_path.suffix.lower() not in (VIDEO_EXTENSIONS | AUDIO_EXTENSIONS):
        raise HTTPException(status_code=400, detail="file_path must be an audio or video file")

    language_code = (request.language_code or "").strip() or None
    job_id = uuid.uuid4().hex[:12]
    request_options = {
        "model_id": request.model_id.strip() or DEFAULT_MODEL_ID,
        "language_code": language_code,
        "tag_audio_events": request.tag_audio_events,
        "diarize": request.diarize,
        "no_verbatim": request.no_verbatim,
        "num_speakers": request.num_speakers,
        "timestamps_granularity": request.timestamps_granularity,
        "enable_logging": request.enable_logging,
        "temperature": request.temperature,
    }
    job = {
        "id": job_id,
        "provider": "elevenlabs",
        "status": "queued",
        "file_path": str(source_path),
        "file_name": source_path.name,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "started_at": None,
        "finished_at": None,
        "segment_count": None,
        "project_id": None,
        "create_project": request.create_project,
        "raw_response_path": None,
        "srt_path": None,
        "vtt_path": None,
        "txt_path": None,
        "error": None,
        "request_options": request_options,
    }
    elevenlabs_jobs[job_id] = job
    await publish_elevenlabs_event(job_id, "status", {"status": "queued"})
    await publish_elevenlabs_event(job_id, "log", {"message": f"Queued {source_path.name}"})
    background_tasks.add_task(run_elevenlabs_job, job_id)
    return {"status": "accepted", "job": public_elevenlabs_job(job)}


@app.get("/api/elevenlabs/jobs/{job_id}")
async def get_elevenlabs_job(job_id: str) -> dict[str, Any]:
    job = elevenlabs_jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        "job": public_elevenlabs_job(job),
        "events": elevenlabs_event_history.get(job_id, []),
    }


@app.get("/api/elevenlabs/jobs/{job_id}/export/{format_name}")
async def export_elevenlabs_job(job_id: str, format_name: str):
    job = elevenlabs_jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.get("status") != "finished":
        raise HTTPException(status_code=400, detail="Job has not finished")

    path_by_format = {
        "json": job.get("raw_response_path"),
        "srt": job.get("srt_path"),
        "vtt": job.get("vtt_path"),
        "txt": job.get("txt_path"),
    }
    export_path_value = path_by_format.get(format_name)
    if not export_path_value:
        raise HTTPException(status_code=404, detail="Unsupported export format")

    export_path = Path(export_path_value)
    if not export_path.exists():
        raise HTTPException(status_code=404, detail="Export file not found")

    media_type_by_format = {
        "json": "application/json",
        "srt": "application/x-subrip",
        "vtt": "text/vtt",
        "txt": "text/plain",
    }
    return FileResponse(
        export_path,
        media_type=media_type_by_format[format_name],
        filename=export_path.name,
    )


@app.websocket("/api/elevenlabs/jobs/{job_id}/events")
async def elevenlabs_job_events(websocket: WebSocket, job_id: str):
    await websocket.accept()
    queue: asyncio.Queue = asyncio.Queue(maxsize=100)
    elevenlabs_event_queues.setdefault(job_id, set()).add(queue)
    try:
        for event in elevenlabs_event_history.get(job_id, []):
            await websocket.send_json(event)
        while True:
            event = await queue.get()
            await websocket.send_json(event)
    except WebSocketDisconnect:
        pass
    finally:
        queues = elevenlabs_event_queues.get(job_id)
        if queues:
            queues.discard(queue)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/projects")
async def list_projects() -> list[dict[str, Any]]:
    projects = []
    for path in sorted(TRANSCRIPT_DATA_DIR.glob("*/project.json"), reverse=True):
        try:
            project = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        audio_path = path.parent / str(project.get("audio_path") or "")
        if not project.get("audio_path") or not audio_path.exists() or audio_path.stat().st_size < 100:
            continue
        projects.append(
            {
                "id": project["id"],
                "audio_filename": display_filename(project.get("audio_filename")),
                "transcript_filename": display_filename(project.get("transcript_filename")),
                "segment_count": len(project.get("segments", [])),
                "updated_at": project.get("updated_at"),
            }
        )
    return sorted(projects, key=lambda item: item.get("updated_at") or "", reverse=True)


@app.post("/api/projects")
async def create_project(payload: ProjectCreate) -> dict[str, Any]:
    try:
        segments = parse_transcript(payload.transcript_filename, payload.transcript_text)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not parse transcript: {exc}") from exc
    if not segments:
        raise HTTPException(status_code=400, detail="Transcript did not contain editable segments")

    project_id = uuid.uuid4().hex[:12]
    directory = TRANSCRIPT_DATA_DIR / project_id
    directory.mkdir(parents=True)

    project = {
        "id": project_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "audio_filename": safe_filename(payload.audio_filename),
        "audio_type": payload.audio_type or mimetypes.guess_type(payload.audio_filename)[0] or "audio/mpeg",
        "audio_path": None,
        "transcript_filename": safe_filename(payload.transcript_filename),
        "segments": renumber_segments(segments),
        "playback_state": {"current_time": 0, "selected_id": 1},
    }
    write_transcript_project(project)
    return project


@app.put("/api/projects/{project_id}/audio")
async def upload_audio(
    project_id: str,
    request: Request,
    x_filename: str | None = Header(default=None),
    content_type: str | None = Header(default=None),
) -> dict[str, Any]:
    directory = transcript_project_dir(project_id)
    project = read_transcript_project(project_id)
    filename = safe_filename(x_filename or project.get("audio_filename") or "audio")
    audio_dir = directory / "audio"
    audio_dir.mkdir(exist_ok=True)
    target = audio_dir / filename
    with target.open("wb") as buffer:
        async for chunk in request.stream():
            buffer.write(chunk)
    project["audio_filename"] = filename
    project["audio_type"] = content_type or project.get("audio_type") or "audio/mpeg"
    project["audio_path"] = str(target.relative_to(directory))
    write_transcript_project(project)
    return {"audio_url": f"/api/projects/{project_id}/audio", "project": project}


@app.get("/api/projects/{project_id}")
async def get_project(project_id: str) -> dict[str, Any]:
    return read_transcript_project(project_id)


@app.patch("/api/projects/{project_id}")
async def update_project(project_id: str, payload: ProjectUpdate) -> dict[str, Any]:
    project = read_transcript_project(project_id)
    project["segments"] = renumber_segments(payload.segments)
    if payload.playback_state is not None:
        project["playback_state"] = {
            "current_time": max(0, round(float(payload.playback_state.current_time), 3)),
            "selected_id": payload.playback_state.selected_id,
        }
    write_transcript_project(project)
    return project


@app.delete("/api/projects/{project_id}")
async def delete_project(project_id: str) -> dict[str, str]:
    directory = transcript_project_dir(project_id)
    shutil.rmtree(directory)
    return {"status": "deleted"}


@app.get("/api/projects/{project_id}/audio")
async def get_audio(project_id: str) -> FileResponse:
    directory = transcript_project_dir(project_id)
    project = read_transcript_project(project_id)
    relative_path = project.get("audio_path")
    if not relative_path:
        raise HTTPException(status_code=404, detail="Audio has not been uploaded")
    path = directory / relative_path
    if not path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found")
    return FileResponse(
        path,
        media_type=project.get("audio_type") or "application/octet-stream",
        filename=project.get("audio_filename") or path.name,
    )


@app.get("/api/projects/{project_id}/export/{format_name}")
async def export_project(project_id: str, format_name: str):
    project = read_transcript_project(project_id)
    segments = project.get("segments", [])
    stem = Path(project.get("transcript_filename") or "transcript").stem
    if format_name == "srt":
        return PlainTextResponse(
            export_srt(segments),
            media_type="application/x-subrip",
            headers=attachment_headers(f"{stem}.edited.srt"),
        )
    if format_name == "vtt":
        return PlainTextResponse(
            export_vtt(segments),
            media_type="text/vtt",
            headers=attachment_headers(f"{stem}.edited.vtt"),
        )
    if format_name == "txt":
        return PlainTextResponse(
            export_txt(segments),
            media_type="text/plain",
            headers=attachment_headers(f"{stem}.edited.txt"),
        )
    if format_name == "csv":
        return PlainTextResponse(
            export_csv(segments),
            media_type="text/csv",
            headers=attachment_headers(f"{stem}.edited.csv"),
        )
    if format_name == "json":
        return JSONResponse(
            project,
            headers=attachment_headers(f"{stem}.edited.json"),
        )
    raise HTTPException(status_code=404, detail="Unsupported export format")


app.mount("/", StaticFiles(directory=FRONTENDS_DIR, html=True), name="static")
