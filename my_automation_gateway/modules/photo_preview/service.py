from __future__ import annotations

import importlib.util
import json
import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


JPEG_EXTENSIONS = {".jpg", ".jpeg"}
CAMERA_PREFIXES = ("IMG_", "DSC_")
MANIFEST_NAME = ".photo-preview-manifest.json"
PREVIEW_FOLDER_NAME = "PREVIEW"


class PhotoPreviewError(ValueError):
    """Raised when the photo preview job cannot be planned or rendered."""


@dataclass(frozen=True)
class PreviewOptions:
    source_dir: Path
    output_format: str = "webp"
    max_side: int = 1920
    quality: int = 80
    name_filter: str = "all"
    skip_unchanged: bool = True
    dry_run: bool = False
    workers: int = 4
    preview_folder_name: str = PREVIEW_FOLDER_NAME


@dataclass(frozen=True)
class PreviewTask:
    source_path: Path
    preview_dir: Path
    preview_path: Path
    source_size: int
    source_mtime_ns: int


@dataclass(frozen=True)
class PreviewSkip:
    source_path: Path
    preview_path: Path
    reason: str
    source_size: int


@dataclass
class PreviewPlan:
    source_dir: Path
    tasks: list[PreviewTask]
    skipped: list[PreviewSkip]
    manifests: dict[Path, dict[str, Any]]
    source_count: int
    original_bytes: int


@dataclass(frozen=True)
class PreviewResult:
    source_path: Path
    preview_path: Path
    source_size: int
    preview_size: int
    width: int
    height: int


def pillow_available() -> bool:
    return importlib.util.find_spec("PIL") is not None


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def resolve_source_dir(value: str) -> Path:
    candidate = Path(value).expanduser()
    if not candidate.is_absolute():
        candidate = Path.cwd() / candidate
    if not candidate.exists() or not candidate.is_dir():
        raise PhotoPreviewError("Source folder does not exist")
    return candidate.resolve()


def options_from_request(payload: Any) -> PreviewOptions:
    source_dir = resolve_source_dir(payload.source_path)
    return PreviewOptions(
        source_dir=source_dir,
        output_format=payload.output_format,
        max_side=payload.max_side,
        quality=payload.quality,
        name_filter=payload.name_filter,
        skip_unchanged=payload.skip_unchanged,
        dry_run=payload.dry_run,
        workers=payload.workers,
    )


def is_preview_dirname(name: str, preview_folder_name: str = PREVIEW_FOLDER_NAME) -> bool:
    return name.casefold() == preview_folder_name.casefold()


def matches_name_filter(path: Path, name_filter: str) -> bool:
    if name_filter == "all":
        return True
    upper_name = path.name.upper()
    return upper_name.startswith(CAMERA_PREFIXES)


def iter_source_jpegs(options: PreviewOptions) -> list[Path]:
    sources: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(options.source_dir):
        dirnames[:] = [
            dirname
            for dirname in dirnames
            if not is_preview_dirname(dirname, options.preview_folder_name)
        ]
        current_dir = Path(dirpath)
        for filename in filenames:
            if filename.startswith("."):
                continue
            path = current_dir / filename
            if path.suffix.lower() not in JPEG_EXTENSIONS:
                continue
            if not matches_name_filter(path, options.name_filter):
                continue
            sources.append(path.resolve())
    return sorted(sources, key=lambda path: str(path).casefold())


def preview_path_for(source_path: Path, options: PreviewOptions) -> Path:
    preview_dir = source_path.parent / options.preview_folder_name
    if options.output_format == "webp":
        return preview_dir / f"{source_path.stem}.webp"
    return preview_dir / source_path.name


def empty_manifest() -> dict[str, Any]:
    return {
        "schema_version": "photo-preview.v1",
        "updated_at": utc_now(),
        "items": {},
    }


def load_manifest(preview_dir: Path) -> dict[str, Any]:
    path = preview_dir / MANIFEST_NAME
    if not path.exists():
        return empty_manifest()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return empty_manifest()
    if not isinstance(payload, dict) or not isinstance(payload.get("items"), dict):
        return empty_manifest()
    return payload


def save_manifest(preview_dir: Path, manifest: dict[str, Any]) -> None:
    preview_dir.mkdir(parents=True, exist_ok=True)
    manifest["updated_at"] = utc_now()
    path = preview_dir / MANIFEST_NAME
    temp_path = preview_dir / f".{MANIFEST_NAME}.{uuid.uuid4().hex}.tmp"
    temp_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    temp_path.replace(path)


def manifest_key(source_path: Path) -> str:
    return source_path.name


def is_preview_current(
    source_path: Path,
    preview_path: Path,
    source_size: int,
    source_mtime_ns: int,
    manifest: dict[str, Any],
    options: PreviewOptions,
) -> bool:
    if not preview_path.exists():
        return False

    item = manifest.get("items", {}).get(manifest_key(source_path))
    if item:
        return (
            item.get("preview_name") == preview_path.name
            and item.get("source_size") == source_size
            and item.get("source_mtime_ns") == source_mtime_ns
            and item.get("output_format") == options.output_format
            and item.get("max_side") == options.max_side
            and item.get("quality") == options.quality
        )

    return preview_path.stat().st_mtime_ns >= source_mtime_ns


def build_preview_plan(options: PreviewOptions) -> PreviewPlan:
    sources = iter_source_jpegs(options)
    manifests: dict[Path, dict[str, Any]] = {}
    tasks: list[PreviewTask] = []
    skipped: list[PreviewSkip] = []
    planned_outputs: set[Path] = set()
    original_bytes = 0

    for source_path in sources:
        try:
            stat = source_path.stat()
        except OSError:
            continue
        preview_path = preview_path_for(source_path, options).resolve()
        preview_dir = preview_path.parent
        source_size = stat.st_size
        source_mtime_ns = stat.st_mtime_ns
        original_bytes += source_size

        if preview_path in planned_outputs:
            skipped.append(
                PreviewSkip(
                    source_path=source_path,
                    preview_path=preview_path,
                    reason="duplicate preview name",
                    source_size=source_size,
                )
            )
            continue

        manifest = manifests.setdefault(preview_dir, load_manifest(preview_dir))
        if options.skip_unchanged and is_preview_current(
            source_path,
            preview_path,
            source_size,
            source_mtime_ns,
            manifest,
            options,
        ):
            skipped.append(
                PreviewSkip(
                    source_path=source_path,
                    preview_path=preview_path,
                    reason="unchanged",
                    source_size=source_size,
                )
            )
            planned_outputs.add(preview_path)
            continue

        tasks.append(
            PreviewTask(
                source_path=source_path,
                preview_dir=preview_dir,
                preview_path=preview_path,
                source_size=source_size,
                source_mtime_ns=source_mtime_ns,
            )
        )
        planned_outputs.add(preview_path)

    return PreviewPlan(
        source_dir=options.source_dir,
        tasks=tasks,
        skipped=skipped,
        manifests=manifests,
        source_count=len(sources),
        original_bytes=original_bytes,
    )


def render_preview(task: PreviewTask, options: PreviewOptions) -> PreviewResult:
    try:
        from PIL import Image, ImageOps
    except ModuleNotFoundError as exc:
        raise PhotoPreviewError("Pillow is not installed. Run pip install -r requirements.txt") from exc

    task.preview_dir.mkdir(parents=True, exist_ok=True)
    temp_path = task.preview_dir / f".{task.preview_path.name}.{uuid.uuid4().hex}.tmp"

    try:
        with Image.open(task.source_path) as image:
            image = ImageOps.exif_transpose(image)
            if image.mode not in {"RGB", "L"}:
                image = image.convert("RGB")
            image.thumbnail((options.max_side, options.max_side), Image.Resampling.LANCZOS)

            if options.output_format == "webp":
                if image.mode == "L":
                    image = image.convert("RGB")
                image.save(temp_path, "WEBP", quality=options.quality, method=6)
            else:
                if image.mode != "RGB":
                    image = image.convert("RGB")
                image.save(
                    temp_path,
                    "JPEG",
                    quality=options.quality,
                    optimize=True,
                    progressive=True,
                )

        temp_path.replace(task.preview_path)
        preview_size = task.preview_path.stat().st_size
        with Image.open(task.preview_path) as preview_image:
            width, height = preview_image.size
        return PreviewResult(
            source_path=task.source_path,
            preview_path=task.preview_path,
            source_size=task.source_size,
            preview_size=preview_size,
            width=width,
            height=height,
        )
    except Exception:
        if temp_path.exists():
            temp_path.unlink()
        raise


def manifest_record(task: PreviewTask, result: PreviewResult, options: PreviewOptions) -> dict[str, Any]:
    return {
        "preview_name": task.preview_path.name,
        "source_size": task.source_size,
        "source_mtime_ns": task.source_mtime_ns,
        "output_format": options.output_format,
        "max_side": options.max_side,
        "quality": options.quality,
        "preview_size": result.preview_size,
        "width": result.width,
        "height": result.height,
        "generated_at": utc_now(),
    }


def public_task_path(path: Path, source_dir: Path) -> str:
    try:
        return str(path.relative_to(source_dir))
    except ValueError:
        return str(path)
