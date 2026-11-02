"""Offline QA for persistent human-reviewed student learning and CPU training."""
import json
import os
import sys
import unittest
from unittest import mock
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "autodub"))
import student_learning as ml

def unpack(value):
    return value["statusCode"], json.loads(value["body"])

class StubTable:
    def __init__(self):
        self.rows = []
    def put_item(self, Item):
        self.rows.append(Item)
        return {}

class StudentLearningTests(unittest.TestCase):
    def test_owner_review_is_required_and_text_is_validated(self):
        table=StubTable()
        with mock.patch.object(ml, "_table", return_value=table):
            status,_=unpack(ml.handle("student.lesson",{
                "projectId":"story001", "lesson":{"text":"ไม่ ไม่ อย่า", "label":"keep"}}))
            self.assertEqual(status,400)
            status,_=unpack(ml.handle("student.lesson",{
                "projectId":"story001", "lesson":{"text":"ไม่ ไม่ อย่า", "label":"wrong",
                "reviewedByOwner":True}}))
            self.assertEqual(status,400)
            status,result=unpack(ml.handle("student.lesson",{
                "projectId":"story001", "lesson":{"text":"ไม่ ไม่ อย่า",
                "label":"keep","reviewedByOwner":True,"context":{"emotion":"fear"},
                "studentDecision":"remove", "ownerReason":"ตัวละครกำลังตกใจ"}}))
            self.assertEqual(status,200)
            self.assertTrue(result["saved"])
            self.assertFalse(result["trained"])
            self.assertEqual(len(table.rows),1)
            self.assertEqual(table.rows[0]["record"]["source"],"user-reviewed")

    def test_cpu_train_rejects_data_shortage(self):
        with mock.patch.object(ml,"_get_lessons",return_value=[]):
            status,result=unpack(ml.handle("student.train",{}))
            self.assertEqual(status,409)
            self.assertFalse(result["trained"])
            self.assertEqual(result["counts"]["rows"],0)

    def test_group_disjoint_train_stores_candidate_only(self):
        examples=[]
        labels=["keep","remove","review"]
        for i in range(5):
            for label in labels:
                for j in range(7):
                    if label=="keep":
                        sample="อย่า อย่า เปิดประตู! กลัวมาก! "+str(i)+str(j)
                        emotion="fear"
                    elif label=="remove":
                        sample="แล้วก็ แล้วก็ เดินไปตลาด "+str(i)+str(j)
                        emotion="neutral"
                    else:
                        sample="เอ่อ เอ่อ จะทำอย่างไรดี "+str(i)+str(j)
                        emotion="hesitation"
                    examples.append({"record":{"projectId":"story%d"%i,"label":label,
                       "text":sample, "context":{"emotion":emotion,"mode":"narration"}},
                       "status":"approved-for-training"})
        saved=StubTable()
        with mock.patch.object(ml,"_get_lessons",return_value=examples), \
             mock.patch.object(ml,"_table",return_value=saved):
            status,result=unpack(ml.handle("student.train",{}))
        self.assertEqual(status,200)
        self.assertTrue(result["trained"])
        self.assertFalse(result["activated"])
        self.assertEqual(result["candidate"]["metrics"]["stories"],5)
        self.assertGreater(result["candidate"]["metrics"]["testRows"],0)
        self.assertEqual(len(saved.rows),1)
        self.assertEqual(saved.rows[0]["status"],"candidate")
        # No active inference without a separate explicit activation.
        self.assertTrue(saved.rows[0]["sk"].startswith("model#"))

    def test_activation_requires_qa_and_owner_approval(self):
        model={"version":"20261102001-deadbeef","metrics":{"qaPassed":False}}
        saved=StubTable()
        with mock.patch.object(ml,"_read_model",return_value=model), \
             mock.patch.object(ml,"_table",return_value=saved):
            status,_=unpack(ml.handle("student.activate",{
               "version":model["version"],"approvedByOwner":True}))
            self.assertEqual(status,409)
            self.assertEqual(len(saved.rows),0)
            model["metrics"]["qaPassed"]=True
            status,_=unpack(ml.handle("student.activate",{
               "version":model["version"],"approvedByOwner":False}))
            self.assertEqual(status,400)
            status,result=unpack(ml.handle("student.activate",{
               "version":model["version"],"approvedByOwner":True}))
            self.assertEqual(status,200)
            self.assertTrue(result["activated"])
            self.assertEqual(saved.rows[0]["sk"],"active")
            self.assertEqual(saved.rows[0]["model"]["status"],"active-advisory")

    def test_ngrams_for_thai_text_and_context(self):
        tokens=ml._tokens("ไม่ ไม่ อย่า",{"mode":"dialogue","emotion":"fear"})
        self.assertIn("g:ไม",tokens)
        self.assertIn("c:mode:dialogue",tokens)
        self.assertIn("c:emotion:fear",tokens)

if __name__ == "__main__":
    unittest.main()
