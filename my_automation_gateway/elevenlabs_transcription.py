from __future__ import annotations

import mimetypes
from pathlib import Path
from typing import Any

import httpx


ELEVENLABS_STT_URL = "https://api.elevenlabs.io/v1/speech-to-text"
ELEVENLABS_SUBSCRIPTION_URL = "https://api.elevenlabs.io/v1/user/subscription"
DEFAULT_MODEL_ID = "scribe_v2"


class ElevenLabsTranscriptionError(RuntimeError):
    pass


async def create_elevenlabs_transcript(
    *,
    api_key: str,
    file_path: Path,
    model_id: str = DEFAULT_MODEL_ID,
    language_code: str | None = None,
    tag_audio_events: bool = False,
    diarize: bool = True,
    no_verbatim: bool = True,
    num_speakers: int | None = None,
    timestamps_granularity: str = "word",
    enable_logging: bool = True,
    temperature: float | None = None,
) -> dict[str, Any]:
    data: dict[str, str] = {
        "model_id": model_id,
        "tag_audio_events": bool_text(tag_audio_events),
        "diarize": bool_text(diarize),
        "timestamps_granularity": timestamps_granularity,
    }
    if no_verbatim:
        data["no_verbatim"] = "true"
    if language_code:
        data["language_code"] = language_code
    if num_speakers is not None:
        data["num_speakers"] = str(num_speakers)
    if temperature is not None:
        data["temperature"] = str(temperature)

    media_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    params = {}
    if not enable_logging:
        params["enable_logging"] = "false"
    headers = {"xi-api-key": api_key}
    timeout = httpx.Timeout(connect=30.0, read=None, write=None, pool=30.0)

    try:
        with file_path.open("rb") as file_obj:
            files = {"file": (file_path.name, file_obj, media_type)}
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(
                    ELEVENLABS_STT_URL,
                    params=params,
                    headers=headers,
                    data=data,
                    files=files,
                )
    except httpx.HTTPError as exc:
        raise ElevenLabsTranscriptionError(f"ElevenLabs request failed: {exc}") from exc

    if response.status_code >= 400:
        raise ElevenLabsTranscriptionError(format_elevenlabs_error(response))

    try:
        return response.json()
    except ValueError as exc:
        raise ElevenLabsTranscriptionError("ElevenLabs returned a non-JSON response") from exc


async def fetch_elevenlabs_subscription(api_key: str) -> dict[str, Any]:
    headers = {"xi-api-key": api_key}
    timeout = httpx.Timeout(connect=10.0, read=30.0, write=10.0, pool=10.0)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.get(ELEVENLABS_SUBSCRIPTION_URL, headers=headers)
    except httpx.HTTPError as exc:
        raise ElevenLabsTranscriptionError(f"ElevenLabs request failed: {exc}") from exc

    if response.status_code >= 400:
        raise ElevenLabsTranscriptionError(format_elevenlabs_error(response))

    try:
        return response.json()
    except ValueError as exc:
        raise ElevenLabsTranscriptionError("ElevenLabs returned a non-JSON response") from exc


def build_segments_from_elevenlabs(payload: dict[str, Any]) -> list[dict[str, Any]]:
    transcript_groups = extract_transcript_groups(payload)
    segments: list[dict[str, Any]] = []

    for group_label, transcript in transcript_groups:
        words = transcript.get("words") if isinstance(transcript, dict) else None
        if isinstance(words, list) and words:
            segments.extend(group_words_into_segments(words, group_label))
            continue

        text = str(transcript.get("text", "") if isinstance(transcript, dict) else "").strip()
        if text:
            segments.append(
                {
                    "id": len(segments) + 1,
                    "start": 0,
                    "end": 1,
                    "speaker": group_label,
                    "text": text,
                }
            )

    if not segments:
        text = str(payload.get("text", "")).strip()
        if text:
            segments.append({"id": 1, "start": 0, "end": 1, "speaker": "", "text": text})

    return renumber_segments(sorted(segments, key=lambda item: (item["start"], item["end"])))


def extract_transcript_groups(payload: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    transcripts = payload.get("transcripts")
    if isinstance(transcripts, dict):
        groups = []
        for key, transcript in transcripts.items():
            if isinstance(transcript, dict):
                groups.append((str(key), transcript))
        if groups:
            return groups

    if isinstance(transcripts, list):
        groups = []
        for index, transcript in enumerate(transcripts, start=1):
            if isinstance(transcript, dict):
                label = str(transcript.get("channel") or transcript.get("speaker_id") or f"channel_{index}")
                groups.append((label, transcript))
        if groups:
            return groups

    return [("", payload)]


def group_words_into_segments(words: list[dict[str, Any]], fallback_speaker: str = "") -> list[dict[str, Any]]:
    segments: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None

    for item in words:
        if not isinstance(item, dict):
            continue
        token = str(item.get("text") or "")
        if not token:
            continue

        start = number_or_none(item.get("start"))
        end = number_or_none(item.get("end"))
        speaker = str(item.get("speaker_id") or fallback_speaker or "")
        is_timed_token = start is not None or end is not None

        if not is_timed_token:
            if current is not None:
                current["text"] = append_token(current["text"], token)
            continue

        token_start = float(start if start is not None else end or 0)
        token_end = float(end if end is not None else start or token_start)

        if current is None or should_start_new_segment(current, token_start, speaker):
            if current is not None:
                flush_segment(segments, current)
            current = {
                "id": len(segments) + 1,
                "start": token_start,
                "end": token_end,
                "speaker": speaker,
                "text": "",
            }

        current["text"] = append_token(current["text"], token)
        current["end"] = max(float(current["end"]), token_end)

    if current is not None:
        flush_segment(segments, current)

    return segments


def should_start_new_segment(current: dict[str, Any], token_start: float, speaker: str) -> bool:
    text = str(current.get("text", "")).strip()
    gap = token_start - float(current.get("end", token_start))
    if speaker != str(current.get("speaker", "")):
        return True
    if gap > 1.2:
        return True
    if len(text) >= 280:
        return True
    if len(text) >= 90 and text.endswith((".", "!", "?", "…")):
        return True
    return False


def append_token(text: str, token: str) -> str:
    if not text:
        return token.lstrip()
    if token.isspace() or token[:1].isspace():
        return text + token
    if token in {".", ",", "!", "?", ":", ";", "%", ")", "]", "}"}:
        return text.rstrip() + token
    if text.endswith((" ", "\n", "(", "[", "{", "—", "-")):
        return text + token
    return f"{text} {token}"


def flush_segment(segments: list[dict[str, Any]], segment: dict[str, Any]) -> None:
    text = str(segment.get("text", "")).strip()
    if not text:
        return
    start = max(0.0, float(segment.get("start", 0)))
    end = max(start + 0.001, float(segment.get("end", start + 0.001)))
    segments.append(
        {
            "id": len(segments) + 1,
            "start": round(start, 3),
            "end": round(end, 3),
            "speaker": str(segment.get("speaker", "")).strip(),
            "text": text,
        }
    )


def renumber_segments(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    renumbered = []
    for index, segment in enumerate(segments, start=1):
        renumbered.append(
            {
                "id": index,
                "start": round(max(0.0, float(segment.get("start", 0))), 3),
                "end": round(max(0.0, float(segment.get("end", 0))), 3),
                "speaker": str(segment.get("speaker", "")).strip(),
                "text": str(segment.get("text", "")).strip(),
            }
        )
    return renumbered


def number_or_none(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def bool_text(value: bool) -> str:
    return "true" if value else "false"


def format_elevenlabs_error(response: httpx.Response) -> str:
    raw_body = response.text[:1000]
    message = raw_body

    try:
        payload = response.json()
    except ValueError:
        payload = None

    if isinstance(payload, dict):
        detail = payload.get("detail")
        if isinstance(detail, dict):
            message = str(detail.get("message") or detail.get("code") or raw_body)
        elif isinstance(detail, str):
            message = detail
        elif payload.get("message"):
            message = str(payload["message"])

    zrm_denied = response.status_code == 403 and (
        "zrm" in message.lower() or "zero retention" in message.lower()
    )
    if zrm_denied:
        return (
            "ElevenLabs rejected Zero Retention Mode for this account. "
            "Leave Zero retention mode disabled unless your ElevenLabs account supports it. "
            f"Provider message: {message}"
        )

    if "user_read" in message.lower():
        return (
            "ElevenLabs API key is missing the user_read permission required to read subscription credits. "
            "Enable user_read for this key or create a new API key with that permission."
        )

    return f"ElevenLabs returned HTTP {response.status_code}: {message}"
