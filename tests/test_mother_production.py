"""Offline tests: no AWS credentials or provider calls."""
import importlib
import json
import sys
import types
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "autodub"))
import teacher_production as production


class MotherProductionTest(unittest.TestCase):
    def setUp(self):
        self.previous = sys.modules.get("teacher")
        self.calls = []
        def response(status, payload):
            return {"statusCode": status, "body": json.dumps(payload, ensure_ascii=False)}
        def chat(body, **kwargs):
            self.calls.append((body, kwargs))
            return response(200, {
                "reply": "ปรับรายละเอียด",
                "provider": body["provider"], "model": "test-model",
                "ops": [
                    {"op": "updateScene", "id": "s1",
                     "patch": {"notes": "กำหนดความลึกฉาก", "duration": 6.5,
                               "voiceover": "บทปลอม", "actors": []}},
                    {"op": "updateScene", "id": "another",
                     "patch": {"notes": "ต้องไม่แก้ฉากนอกคำสั่ง"}},
                ],
            })
        sys.modules["teacher"] = types.SimpleNamespace(
            PROVIDERS=("gemini", "openrouter", "compatible"),
            _response=response, _chat=chat)

    def tearDown(self):
        if self.previous is None:
            sys.modules.pop("teacher", None)
        else:
            sys.modules["teacher"] = self.previous

    def test_owner_gate_and_role_allowlist(self):
        self.assertEqual(production.handle("teacher.production.review", {}, "other")["statusCode"], 403)
        self.assertEqual(production._review({"roleId": "audio-director", "scenes": [{"id": "s1"}]})["statusCode"], 400)

    def test_review_filters_unrequested_scene_and_unsafe_fields(self):
        old = production._connection
        production._connection = lambda body: {"key": "redacted"}
        try:
            req = {"roleId": "timeline-editor", "provider": "gemini",
                   "connectionId": "key-test", "scenes": [{"id": "s1",
                       "duration": 6, "voiceover": "ต้นฉบับ", "notes": ""}]}
            response = production._review(req)
            self.assertEqual(response["statusCode"], 200)
            data = json.loads(response["body"])
            self.assertEqual(len(data["ops"]), 1)
            patch = data["ops"][0]["patch"]
            self.assertEqual(patch, {"notes": "กำหนดความลึกฉาก", "duration": 6.5})
            self.assertNotIn("voiceover", patch)
            self.assertFalse(data["applied"])
            self.assertEqual(self.calls[0][1]["production_role"], "timeline-editor")
            req["roleId"] = "environment-artist"
            data = json.loads(production._review(req)["body"])
            self.assertEqual(data["ops"][0]["patch"], {"notes": "กำหนดความลึกฉาก"})
        finally:
            production._connection = old

    def test_voice_does_not_forge_audio_from_text_provider(self):
        old = production._connection
        production._connection = lambda body: {"key": "redacted"}
        try:
            response = production._speech({"provider": "openrouter",
                "connectionId": "key-test", "text": "ทดสอบเสียง"})
            self.assertEqual(response["statusCode"], 422)
            self.assertNotIn("audio", json.loads(response["body"]))
        finally:
            production._connection = old


if __name__ == "__main__":
    unittest.main()
