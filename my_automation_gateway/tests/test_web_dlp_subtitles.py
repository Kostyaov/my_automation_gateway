import asyncio
import json
from pathlib import Path
import shutil
import tempfile
import unittest
import uuid

import main


@unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg required for conversion")
class SubtitleTests(unittest.TestCase):
    def run_fixture(self, with_subtitles):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            vtt = directory / "source.vtt"
            vtt.write_text("WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nУкраїнські субтитри\n")
            info = {
                "id": "test", "title": "Subtitle test", "extractor": "test",
                "webpage_url": "https://example.org/test",
                "formats": [{"format_id": "test", "url": "https://example.org/video.mp4",
                             "ext": "mp4", "vcodec": "avc1", "acodec": "aac"}],
                "subtitles": {"uk": [{"ext": "vtt", "url": vtt.as_uri()}]} if with_subtitles else {},
            }
            fixture = directory / "info.json"
            fixture.write_text(json.dumps(info))
            command, _ = main.build_web_dlp_command(main.WebDlpJobRequest(
                url="https://example.org/test", operation="download_subtitles",
                output_path=tmp, options={"subtitle_languages": "uk"},
            ))
            command = command[:-1] + ["--enable-file-urls", "--load-info-json", str(fixture)]
            job_id = uuid.uuid4().hex
            job = {"operation": "download_subtitles", "command": command,
                   "output_path": tmp, "options": {}, "status": "queued"}
            main.web_dlp_jobs[job_id] = job
            try:
                asyncio.run(main.run_web_dlp_job(job_id))
                if with_subtitles:
                    self.assertEqual(job["status"], "finished")
                    self.assertEqual(len(job["subtitle_files"]), 1)
                    path = Path(job["subtitle_files"][0])
                    self.assertIn("00:00:00,000 --> 00:00:02,000", path.read_text())
                    self.assertIn("Українські субтитри", path.read_text())
                    self.assertTrue(any("[SRT] Збережено:" in e["data"].get("message", "")
                                        for e in main.web_dlp_event_history[job_id]))
                else:
                    self.assertEqual(job["status"], "failed")
                    self.assertIn("SRT-файлів не створено", job["error"])
            finally:
                main.web_dlp_jobs.pop(job_id, None)
                main.web_dlp_event_history.pop(job_id, None)
                main.web_dlp_event_queues.pop(job_id, None)

    def test_vtt_becomes_verified_srt(self):
        self.run_fixture(True)

    def test_no_subtitles_is_not_reported_as_success(self):
        self.run_fixture(False)


class SubtitlePathsTests(unittest.TestCase):
    def test_unrelated_existing_srt_not_reported(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "old.srt").write_text("old subtitles")
            self.assertEqual(main.web_dlp_subtitle_paths("GATEWAY_SUBTITLES:null", tmp), [])
            self.assertEqual(main.web_dlp_subtitle_paths("GATEWAY_SUBTITLES:[]", tmp), [])
