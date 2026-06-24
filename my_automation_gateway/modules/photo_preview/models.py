from typing import Any, Literal

from pydantic import BaseModel, Field


class PhotoPreviewJobRequest(BaseModel):
    source_path: str = Field(min_length=1)
    output_format: Literal["webp", "jpeg"] = "webp"
    max_side: int = Field(default=1920, ge=320, le=10000)
    quality: int = Field(default=80, ge=1, le=100)
    name_filter: Literal["all", "camera"] = "all"
    skip_unchanged: bool = True
    dry_run: bool = False
    workers: int = Field(default=4, ge=1, le=16)


class FolderOpenRequest(BaseModel):
    path: str | None = None


class PhotoPreviewJobPayload(BaseModel):
    job: dict[str, Any]
    events: list[dict[str, Any]] = Field(default_factory=list)
