"""Sandbox cannot write to real lessons or train/activate child models."""
import json
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "autodub"))
import teacher_sandbox
import teacher

class FakeTable:
    def __init__(self):
        self.saved = []
    def put_item(self, **kwargs):
        self.saved.append(kwargs["Item"])

class SandboxTests(unittest.TestCase):
    def test_rejects_non_admin_and_invalid_scene_without_provider_calls(self):
        with mock.patch.object(teacher, "_chat") as chat:
            code = teacher_sandbox.handle("teacher.sandbox.run", {},
                                           "not-the-owner")["statusCode"]
            self.assertEqual(code, 403)
            invalid = teacher_sandbox.handle("teacher.sandbox.run", {
                "provider": "gemini", "connectionId": "default-gemini",
                "scenes": [{"id": "s01", "text": "a"}]},
                teacher_sandbox.OWNER_ID)
            self.assertEqual(invalid["statusCode"], 400)
            chat.assert_not_called()

    def test_rehearsal_uses_existing_connection_without_training_or_real_lesson_writes(self):
        table = FakeTable()
        teacher_result = teacher._response(200, {
            "teachingLessons": [{"sceneId": "s01", "issue": "keep",
                                 "revised": "นี่คือเนื้อเรื่องทดลอง", "reason": "เนื้อเรื่องถูกต้องตามเดิม"}]})
        with mock.patch.object(teacher_sandbox, "_table", return_value=table), \
             mock.patch.object(teacher, "_settings", return_value={}), \
             mock.patch("teacher_connections.resolve", return_value={"key": "SECRET"}), \
             mock.patch.object(teacher, "_chat", return_value=teacher_result) as chat, \
             mock.patch.object(teacher, "_auto_teach") as real_lesson:
            response=teacher_sandbox.handle("teacher.sandbox.run", {
                "provider": "gemini", "connectionId": "default-gemini",
                "scenes": [{"id": "s01", "text": "นี่คือเนื้อเรื่องทดลอง"}]},
                teacher_sandbox.OWNER_ID)
        self.assertEqual(response["statusCode"], 200)
        body = json.loads(response["body"])
        self.assertTrue(body["saved"])
        self.assertEqual(body["report"]["workspace"], "sandbox")
        self.assertFalse(body["report"]["trainedChildModel"])
        self.assertFalse(body["report"]["writesToProductionLessons"])
        self.assertEqual(table.saved[0]["pk"], teacher_sandbox.PK)
        self.assertNotEqual(table.saved[0]["pk"], "learning#teacher-story-coherence")
        self.assertNotIn("SECRET", response["body"])
        self.assertEqual(chat.call_args.kwargs["teach_mode"], True)
        real_lesson.assert_not_called()

    def test_report_persistence_failure_does_not_claim_success(self):
        table = FakeTable()
        def fail(**kwargs):
            raise RuntimeError("DynamoDB unavailable")
        table.put_item=fail
        with mock.patch.object(teacher_sandbox, "_table", return_value=table), \
             mock.patch.object(teacher, "_settings", return_value={}), \
             mock.patch("teacher_connections.resolve", return_value={"key": "SECRET"}), \
             mock.patch.object(teacher, "_chat", return_value=teacher._response(429, {
                 "reasonCode": "TEACHER_PROVIDER_RATE_LIMIT",
                 "error": "Provider busy"})):
            response = teacher_sandbox.handle("teacher.sandbox.run", {
                "provider": "gemini", "connectionId": "default-gemini",
                "scenes": [{"id": "s01", "text": "นี่คือเนื้อเรื่องทดลอง"}]},
                teacher_sandbox.OWNER_ID)
        self.assertEqual(response["statusCode"], 503)
        self.assertNotIn("SECRET", response["body"])

if __name__=="__main__":
    unittest.main()
