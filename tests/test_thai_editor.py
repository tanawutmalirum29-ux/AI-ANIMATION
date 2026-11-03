"""Thai Script Editor starter tests: actual CPU fit and no unsafe rewriting."""
import json
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "autodub"))
import thai_editor as child


def decode(reply):
    return reply["statusCode"], json.loads(reply["body"])


class MemoryTable:
    def __init__(self):
        self.rows = []

    def put_item(self, Item, **kwargs):
        self.rows.append(Item)


class ThaiEditorTests(unittest.TestCase):
    def test_starter_is_actually_trained_with_group_disjoint_holdout(self):
        model = child._baseline()
        m = model["metrics"]
        self.assertEqual(m["trainRows"], 90)
        self.assertEqual(m["holdoutRows"], 30)
        self.assertEqual(m["storyGroupsTrain"], 9)
        self.assertEqual(m["storyGroupsHoldout"], 3)
        self.assertTrue(m["baselineTrainedCPU"])
        self.assertTrue(m["holdoutIsSynthetic"])
        self.assertFalse(m["externalRealWorldValidated"])
        self.assertEqual(len(model["classes"]), 5)
        self.assertGreater(model["vocab"], 20)
        self.assertTrue(all(model["classes"][k]["docs"] >= 15 for k in child.LABELS))
        self.assertGreaterEqual(m["holdoutAccuracy"], 0)
        self.assertLessEqual(m["holdoutAccuracy"], 1)
        self.assertEqual(m["majorityBaseline"], 0.2)
        self.assertIn("thai-editor-cpu-starter-v1-", model["version"])

    def test_propose_typo_but_never_mutate_original(self):
        original = "งสนนี้เราต้องทำให้สำเร็จ"
        input_scene = {"id": "ep1-s01", "text": original,
                       "episodeId": "ep1", "previous": "เจ้าหน้าที่กำลังประชุม",
                       "next": "ทุกคนพยักหน้า"}
        code, value = decode(child.handle("editor.review", {"scenes": [input_scene]}))
        self.assertEqual(code, 200)
        choice = value["suggestions"][0]
        self.assertEqual(choice["issue"], "typo")
        self.assertEqual(choice["original"], original)
        self.assertEqual(choice["suggested"], "งานนี้เราต้องทำให้สำเร็จ")
        self.assertFalse(choice["appliedToProject"])
        self.assertTrue(choice["requiresHumanReview"])
        self.assertFalse(choice["confidenceCalibrated"])
        self.assertEqual(input_scene["text"], original)

    def test_emotional_repetition_and_dialect_are_preserved(self):
        for raw in ("ไม่ ไม่ ไม่! อย่าเข้ามานะ!",
                    "ฉัน ฉันไม่รู้ว่าจะบอกยังไง",
                    "เค้าก็อยากไปด้วยอ่ะ"):
            scene = {"id": "s01", "text": raw, "previous": "เขากำลังตกใจ",
                     "next": "เพื่อนเข้ามาปลอบ"}
            code, result = decode(child.review({"scenes": [scene]}))
            self.assertEqual(code, 200)
            choice = result["suggestions"][0]
            self.assertEqual(choice["issue"], "intentional")
            self.assertIsNone(choice["suggested"])

    def test_unknown_contextual_lexeme_is_not_force_corrected(self):
        scene = {"id": "s01", "text": "ประธานอ่านคำพิพากษาของสภา",
                 "previous": "ทุกคนรอลงมติ", "next": "สมาชิกยกมือ"}
        code, result = decode(child.review({"scenes": [scene]}))
        self.assertEqual(code, 200)
        self.assertIsNone(result["suggestions"][0]["suggested"])
        self.assertTrue(result["suggestions"][0]["requiresHumanReview"])

    def test_rejects_duplicates_oversized_and_invalid_context(self):
        base = {"id": "s1", "text": "นี่คือบทที่ต้องตรวจ"}
        for invalid in (
                {"scenes": []},
                {"scenes": [base] * 2},
                {"scenes": [dict(base, text="ก") ]},
                {"scenes": [dict(base, previous="ก" * 351)]},
                {"scenes": [dict(base, next=22)]},
                {"scenes": [dict(base, id="")]},
                {"scenes": [dict(base, text="ก" * 1201)]},
                {"scenes": [dict(base, id="x" + str(i)) for i in range(19)]}):
            code, _ = decode(child.review(invalid))
            self.assertEqual(code, 400, invalid)

    def test_feedback_requires_explicit_owner_review_and_good_labels(self):
        original = "งสนนี้เราต้องทำให้สำเร็จ"
        body = {"projectId": "editor-project-01", "lesson": {
            "sceneId": "s1", "original": original,
            "revised": "งานนี้เราต้องทำให้สำเร็จ",
            "issue": "typo", "previous": "", "next": "",
            "reviewedByOwner": False}}
        code, _ = decode(child.feedback(body))
        self.assertEqual(code, 400)
        table = MemoryTable()
        with mock.patch.object(child, "_table", return_value=table):
            body["lesson"]["reviewedByOwner"] = True
            code, result = decode(child.feedback(body))
        self.assertEqual(code, 200, result)
        self.assertTrue(result["saved"])
        self.assertFalse(result["usedForWeightTraining"])
        self.assertEqual(table.rows[0]["pk"], child.PK)
        self.assertEqual(table.rows[0]["status"], "owner-approved-pending-retrain")
        self.assertFalse(table.rows[0]["record"]["usedForWeightTraining"])
        with mock.patch.object(child, "_table", return_value=table):
            changed = {**body, "lesson": {**body["lesson"], "issue": "keep"}}
            self.assertEqual(child.feedback(changed)["statusCode"], 400)
            intentional = {**body, "lesson": {**body["lesson"],
                "issue": "intentional", "revised": original}}
            self.assertEqual(child.feedback(intentional)["statusCode"], 200)

    def test_status_does_not_need_external_api_or_dynamodb(self):
        with mock.patch.object(child, "_table", side_effect=AssertionError("no AWS read")):
            code, result = decode(child.status())
        self.assertEqual(code, 200)
        self.assertEqual(result["status"], "starter-trained-experimental")
        self.assertFalse(result["canAutoApply"])
        self.assertFalse(result["trainedExternalLLMWeights"])
        self.assertNotIn("apiKey", json.dumps(result))


if __name__ == "__main__":
    unittest.main()
