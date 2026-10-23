"""Offline checks using yt-dlp's real format selector; no media is downloaded."""
import unittest
from pathlib import Path
from unittest.mock import patch

from yt_dlp import YoutubeDL
import main


class UkrainianAudioTests(unittest.TestCase):
    def command(self, operation="download_video", enabled=True, **options):
        with patch.object(main, "resolve_web_dlp_output_dir", return_value=Path("/tmp")), patch.object(
            main, "yt_dlp_base_command", return_value=["yt-dlp"]
        ):
            return main.build_web_dlp_command(main.WebDlpJobRequest(
                url="https://www.youtube.com/watch?v=example",
                operation=operation,
                options={"ukrainian_audio": enabled, **options},
            ))[0]

    def select(self, formats, **options):
        command = self.command(**options)
        selector = command[command.index("-f") + 1]
        with YoutubeDL({"quiet": True}) as ydl:
            return list(ydl.build_format_selector(selector)({
                "formats": formats, "has_merged_format": False,
                "incomplete_formats": False,
            }))

    def formats(self, language="uk", note="dubbed-auto"):
        return [
            dict(format_id="uk-audio", language=language, format_note=note,
                 vcodec="none", acodec="mp4a", ext="m4a", url="https://example.org/uk"),
            dict(format_id="en-audio", language="en", vcodec="none",
                 acodec="mp4a", ext="m4a", url="https://example.org/en"),
            dict(format_id="video720", height=720, vcodec="avc1", acodec="none",
                 ext="mp4", url="https://example.org/720"),
            dict(format_id="video1080", height=1080, vcodec="avc1", acodec="none",
                 ext="mp4", url="https://example.org/1080"),
            dict(format_id="combined-en", language="en", height=720,
                 vcodec="avc1", acodec="mp4a", ext="mp4", url="https://example.org/combined"),
        ]

    def test_ukrainian_including_auto_dubbing_and_regional_tags(self):
        for language in ("uk", "uk-UA", "uk_UA"):
            for note in ("original", "dubbed", "dubbed-auto"):
                with self.subTest(language=language, note=note):
                    selected = self.select(self.formats(language, note), quality="720")
                    self.assertEqual(selected[0]["format_id"], "video720+uk-audio")

    def test_missing_ukrainian_never_falls_back_to_english(self):
        for operation in ("download_video", "extract_audio"):
            self.assertEqual(self.select(self.formats("en"), operation=operation), [])

    def test_audio_only(self):
        self.assertEqual(self.select(self.formats(), operation="extract_audio")[0]["format_id"], "uk-audio")

    def test_combined_ukrainian_fallback(self):
        combined = self.formats()[-1]
        combined.update(language="uk", format_id="combined-uk")
        self.assertEqual(self.select([combined])[0]["format_id"], "combined-uk")

    def test_defaults_and_unrelated_operations_unchanged(self):
        command = self.command(enabled=False, quality="720")
        self.assertEqual(command[command.index("-f") + 1], main.WEB_DLP_QUALITY_FORMATS["720"])
        for operation in ("metadata", "download_subtitles"):
            self.assertEqual(self.command(operation, True), self.command(operation, False))

    def test_separate_filename_and_playlist(self):
        command = self.command(download_playlist=True)
        self.assertIn("[uk]", command[command.index("-o") + 1])
        self.assertNotIn("--no-playlist", command)
        self.assertIn("--no-playlist", self.command())


if __name__ == "__main__":
    unittest.main()
