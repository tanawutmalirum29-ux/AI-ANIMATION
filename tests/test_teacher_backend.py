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


class ProviderOutputTests(unittest.TestCase):
    def setUp(self):
        teacher._REQUEST_TIMES.clear()

    def _call(self, provider, upstream, model=None, **flags):
        model = model or ("gemini-3.5-flash-lite" if provider == "gemini"
                          else "openrouter/free")
        with mock.patch.object(teacher, "_settings", return_value={
            provider: {"key": "offline-secret-do-not-expose", "model": model}
        }), mock.patch.object(teacher, "_post_json", return_value=upstream) as post:
            result = payload(teacher._chat({
                "provider": provider, "message": "ช่วยอธิบาย AI แม่",
                "context": "status only", "_internalMaxOutput": 1400
            }, **flags))
            return result, post

    def test_gemini_thinking_exhaustion_has_useful_diagnostic(self):
        (code, result), post = self._call("gemini", {
            "candidates": [{"finishReason": "MAX_TOKENS", "content": {"parts": []}}],
            "usageMetadata": {"thoughtsTokenCount": 1400}
        }, advisor_mode=True)
        self.assertEqual(code, 502)
        self.assertEqual(result["reasonCode"], "TEACHER_PROVIDER_OUTPUT_LIMIT")
        self.assertNotIn("offline-secret-do-not-expose", json.dumps(result))
        self.assertEqual(post.call_count, 1, "do not silently waste another request")
        generation = post.call_args.args[2]["generationConfig"]
        self.assertGreaterEqual(generation["maxOutputTokens"], 2400)
        self.assertEqual(generation["thinkingConfig"], {"thinkingLevel": "minimal"})

    def test_gemini_pro_uses_low_thinking_not_unsupported_minimal(self):
        (code, result), post = self._call("gemini", {
            "candidates": [{"finishReason": "STOP", "content": {
                "parts": [{"text": '{"reply":"ตรวจแล้ว","ops":[]}'}]}}]
        }, model="gemini-3.1-pro", advisor_mode=True)
        self.assertEqual(code, 200)
        self.assertEqual(result["reply"], "ตรวจแล้ว")
        self.assertEqual(post.call_args.args[2]["generationConfig"]
                         ["thinkingConfig"]["thinkingLevel"], "low")

    def test_gemini_blocked_and_thought_only_are_never_presented_as_answers(self):
        (blocked, result), _ = self._call("gemini", {
            "candidates": [], "promptFeedback": {"blockReason": "SAFETY"}
        }, advisor_mode=True)
        self.assertEqual(blocked, 422)
        self.assertEqual(result["reasonCode"], "TEACHER_PROVIDER_BLOCKED")
        (code, result), _ = self._call("gemini", {
            "candidates": [{"finishReason": "STOP", "content": {
                "parts": [{"thought": True, "text": "private thoughts"}]}}]
        }, advisor_mode=True)
        self.assertEqual(code, 502)
        self.assertEqual(result["reasonCode"], "TEACHER_PROVIDER_EMPTY_RESPONSE")
        self.assertNotIn("private thoughts", json.dumps(result))

    def test_openrouter_empty_reasoning_length_is_explained(self):
        (code, result), post = self._call("openrouter", {
            "choices": [{"finish_reason": "length",
                         "message": {"content": None, "reasoning": "internal"}}]
        }, advisor_mode=True)
        self.assertEqual(code, 502)
        self.assertEqual(result["reasonCode"], "TEACHER_PROVIDER_OUTPUT_LIMIT")
        self.assertEqual(post.call_args.args[2]["max_tokens"], 2400)
        self.assertEqual(post.call_count, 1)

    def test_openai_compatible_content_parts_are_readable(self):
        (code, result), _ = self._call("openrouter", {
            "choices": [{"finish_reason": "stop", "message": {
                "content": [{"type": "text", "text": '{"reply":"สำเร็จ","ops":[]}'},
                            {"type": "reasoning", "text": "do not expose"}]}}]
        }, advisor_mode=True)
        self.assertEqual(code, 200)
        self.assertEqual(result["reply"], "สำเร็จ")
        self.assertNotIn("do not expose", json.dumps(result))

    def test_thinking_limits_dont_change_existing_weight_training_pipeline(self):
        (code, result), post = self._call("gemini", {
            "candidates": [{"content": {"parts": [{"text": json.dumps({
                "teachingLessons": [{"sceneId": "s1", "issue": "keep",
                                     "revised": "บทเดิม", "reason": "รักษาบทที่ผู้ใช้เขียนอย่างครบถ้วน"}]})
            }]}}]
        }, teach_mode=True)
        self.assertEqual(code, 200)
        self.assertEqual(result["teachingLessons"][0]["revised"], "บทเดิม")
        generation = post.call_args.args[2]["generationConfig"]
        self.assertEqual(generation["maxOutputTokens"], 1400)
        self.assertNotIn("thinkingConfig", generation)


if __name__ == "__main__":
    unittest.main()
