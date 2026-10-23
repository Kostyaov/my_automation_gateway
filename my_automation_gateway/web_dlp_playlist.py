"""Ukrainian-only playlist runner, isolated from the normal CLI download path."""
import re
import sys

import yt_dlp


class PlaylistReport:
    def __init__(self):
        self.skipped = set()
        self.completed = 0
        self.errors = 0

    def match(self, info, *, incomplete=False):
        # Flat playlist entries do not contain track information yet.
        if "formats" not in info:
            return None
        formats = info.get("formats") or []
        # An empty format list is an extraction problem, not proof of another language.
        if not formats:
            return None
        has_ukrainian = any(
            re.match(r"^uk(?:[-_]|$)", f.get("language") or "", re.IGNORECASE)
            and (f.get("acodec") not in (None, "none") or f.get("resolution") == "audio only")
            for f in formats
        )
        if has_ukrainian:
            return None
        key = (info.get("extractor_key") or info.get("extractor"), info.get("id"))
        self.skipped.add(key)
        return f"[SKIP] {info.get('title') or info.get('id')}: немає доступної української аудіодоріжки."

    def finished(self, filename):
        self.completed += 1

    def debug(self, message):
        if not message.startswith("[debug]"):
            print(message, flush=True)

    def warning(self, message):
        print(f"WARNING: {message}", file=sys.stderr, flush=True)

    def error(self, message):
        self.errors += 1
        print(f"ERROR: {message}", file=sys.stderr, flush=True)

    def summary(self):
        return (
            f"[SUMMARY] Успішно оброблено: {self.completed}; "
            f"пропущено без української доріжки: {len(self.skipped)}; "
            f"помилок: {self.errors}."
        )


def main(argv=None):
    parsed = yt_dlp.parse_options(argv)
    report = PlaylistReport()
    options = parsed.ydl_opts
    options.update(
        match_filter=report.match,
        ignoreerrors=True,
        logger=report,
        post_hooks=[*options.get("post_hooks", []), report.finished],
    )
    try:
        with yt_dlp.YoutubeDL(options) as downloader:
            result = downloader.download(parsed.urls)
    finally:
        print(report.summary(), flush=True)
    return result or (1 if report.errors else 0)


if __name__ == "__main__":
    sys.exit(main())
