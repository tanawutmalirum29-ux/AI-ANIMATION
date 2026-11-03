"""Offline checks for Teacher gateway: no AWS credentials or internet."""
import json
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "autodub"))
import teacher

def payload(response):
    return response["statusCode"], json.loads(response["body"])

class TeacherBackendTests(unittest.TestCase):
    def test_reject_arbitrary_destination(self):
        with mock.patch.dict(os.environ, {"TEACHER_ALLOWED_API_HOSTS": "api.partner.example"}):
            self.assertTrue(teacher._host_allowed("https://api.partner.example/v1"))
            for address in ("http://api.partner.example/v1", "https://127.0.0.1/v1",
                            "https://api.partner.example.evil.test/v1",
                            "https://user:pw@api.partner.example/v1",
                            "https://api.partner.example:8443/v1"):
                self.assertFalse(teacher._host_allowed(address), address)

    def test_edit_proposals_whitelist_and_bound(self):
        result = teacher._extract_json(json.dumps({
            "reply": "ตรวจแล้ว",
            "ops": [
                {"op": "deleteScene", "id": "a", "patch": {"duration": 3}},
                {"op": "updateScene", "id": "a", "patch": {
                    "duration": 9, "voiceover": "ทดสอบ", "shell": "rm -rf /"}},
                {"op": "updateScene", "id": "b", "patch": {"duration": 999}},
            ]}, ensure_ascii=False))
        self.assertEqual(result["reply"], "ตรวจแล้ว")
        self.assertEqual(result["ops"], [{"op": "updateScene", "id": "a",
                                          "patch": {"voiceover": "ทดสอบ", "duration": 9}}])

    def test_config_requires_secure_store_and_allowlist(self):
        with mock.patch.dict(os.environ, {"TEACHER_SETTINGS_PARAMETER": "",
                                          "TEACHER_SETTINGS_SECRET_ID": ""}):
            status, _ = payload(teacher.handle("teacher.configure", {
                "provider": "openrouter", "apiKey": "sk-test-key-value",
                "model": "example:free"}))
            self.assertEqual(status, 503)
        with mock.patch.dict(os.environ, {"TEACHER_SETTINGS_PARAMETER": "/test",
                                          "TEACHER_ALLOWED_API_HOSTS": ""}):
            status, _ = payload(teacher.handle("teacher.configure", {
                "provider": "compatible", "apiKey": "sk-test-key-value",
                "baseUrl": "https://127.0.0.1/v1", "model": "model"}))
            self.assertEqual(status, 400)

    def test_explicit_owner_model_id_no_longer_blocked_by_price_tier(self):
        with mock.patch.dict(os.environ, {"TEACHER_SETTINGS_PARAMETER": "/test"}), \
             mock.patch.object(teacher, "_settings", return_value={}), \
             mock.patch.object(teacher, "_save_settings") as saved:
            code, result = payload(teacher._configure({
                "provider": "openrouter", "model": "vendor/explicit-model",
                "apiKey": "sk-test-owned-key-123456"}))
        self.assertEqual(code, 200)
        self.assertEqual(result["model"], "vendor/explicit-model")
        self.assertEqual(saved.call_args.args[0]["openrouter"]["model"],
                         "vendor/explicit-model")

    def test_chat_offline_mock_provider(self):
        with mock.patch.object(teacher, "_settings", return_value={
            "openrouter": {"key": "fake-key-for-offline-test", "model": "example:free"}
        }), mock.patch.object(teacher, "_post_json", return_value={
            "choices": [{"message": {"content": json.dumps({
                "reply": "ตรวจฉากแล้ว", "ops": [{"op": "updateScene", "id": "s01",
                "patch": {"duration": 6}}]}, ensure_ascii=False)}}]
        }) as post:
            teacher._REQUEST_TIMES.clear()
            status, result = payload(teacher.handle("teacher.chat", {
                "provider": "openrouter", "message": "Check timing",
                "context": '{"scenes":[{"id":"s01","duration":12}]}'}))
            self.assertEqual(status, 200)
            self.assertEqual(result["ops"][0]["patch"]["duration"], 6)
            self.assertFalse(result["trained"])
            self.assertFalse(result["applied"])
            self.assertEqual(post.call_count, 1)

    def test_feedback_never_fakes_storage(self):
        with mock.patch.dict(os.environ, {"TEACHER_FEEDBACK_TABLE": ""}):
            status, result = payload(teacher.handle("teacher.feedback", {
                "projectId": "story123", "record": {"outcome": "approved"}}))
            self.assertEqual(status, 503)
            self.assertNotIn("saved", result)

if __name__ == "__main__":
    unittest.main()
