import unittest
from unittest.mock import patch
from yt_dlp import YoutubeDL
from web_dlp_playlist import PlaylistReport
import test_web_dlp_audio as audio_tests


class PlaylistTests(unittest.TestCase):
    def test_mixed_playlist_continues_after_skip_and_real_format_error(self):
        report = PlaylistReport()
        helper = audio_tests.UkrainianAudioTests()
        entries = []
        # First/last are valid; English is skipped; incompatible video quality is an error.
        for index, lang in enumerate(["uk", "en", "uk", "uk"]):
            formats = helper.formats(lang)
            if index == 2:
                formats = [f for f in formats if f.get("height", 0) > 720 or f.get("vcodec") == "none"]
            entries.append(dict(id=str(index), title=str(index), formats=formats,
                                extractor="test", webpage_url="https://example.org/" + str(index)))
        with YoutubeDL({
            "quiet": True, "ignoreerrors": True, "logger": report,
            "match_filter": report.match,
            "format": 'bv[height<=720]+ba[language=uk]/b[height<=720][language=uk]',
        }) as ydl:
            result = ydl.process_ie_result(dict(_type="playlist", id="p", title="Mixed", entries=entries, extractor="test", extractor_key="Test", webpage_url="https://example.org/p"), download=False)
        self.assertEqual(len(report.skipped), 1)
        self.assertGreater(report.errors, 0)
        self.assertIsNotNone(result["entries"][-1])
        self.assertEqual(result["entries"][-1]["format_id"], "video720+uk-audio")

    def test_flat_entries_and_unknown_formats_not_falsely_skipped(self):
        report = PlaylistReport()
        self.assertIsNone(report.match({"id": "flat"}, incomplete=True))
        self.assertIsNone(report.match({"formats": []}, incomplete=True))
        self.assertEqual(len(report.skipped), 0)

    def test_auto_dubbed_hls_and_regional_language(self):
        report = PlaylistReport()
        self.assertIsNone(report.match({"formats": [
            {"language": "uk-UA", "resolution": "audio only", "format_note": "dubbed-auto"}
        ]}, incomplete={"format_id"}))

    def test_only_combined_flags_enable_runner(self):
        helper = audio_tests.UkrainianAudioTests()
        with patch("main.importlib.util.find_spec", return_value=object()):
            self.assertTrue(any("web_dlp_playlist.py" in arg for arg in helper.command(download_playlist=True)))
            self.assertFalse(any("web_dlp_playlist.py" in arg for arg in helper.command()))
            self.assertFalse(any("web_dlp_playlist.py" in arg for arg in helper.command(enabled=False, download_playlist=True)))
            for operation in ("metadata", "download_subtitles"):
                self.assertFalse(any("web_dlp_playlist.py" in arg for arg in helper.command(operation, download_playlist=True)))

    def test_skip_count_deduplicates_filter_calls(self):
        report = PlaylistReport()
        info = {"id": "en", "playlist_index": 1, "formats": [{"language": "en", "acodec": "aac"}]}
        report.match(info)
        report.match(info)
        self.assertEqual(len(report.skipped), 1)
        self.assertEqual(report.errors, 0)
