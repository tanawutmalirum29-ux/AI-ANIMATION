"""Offline contract tests: only owner-approved prose revisions enter the private dataset."""
import json
import os
import sys
import unittest
from unittest import mock
sys.path.insert(0,os.path.join(os.path.dirname(__file__),"..","autodub"))
import student_learning as svc

def data(response):
    return response["statusCode"],json.loads(response["body"])

class Memory:
    def __init__(self):self.rows=[]
    def put_item(self,Item):self.rows.append(Item)
class KeyStub:
    def __init__(self,name):self.name=name
    def eq(self,value):return self
    def begins_with(self,value):return self
    def __and__(self,other):return self

class StoryLearningTests(unittest.TestCase):
    def test_requires_owner_review_and_bounded_text(self):
        memory=Memory()
        valid={"projectId":"story123","lesson":{
            "reviewedByOwner":True,"issue":"continuity","original":"เขาอยู่หน้าตลาด",
            "revised":"เขาเดินออกจากตลาดไปที่คลอง",
            "previous":"ฝนตกใกล้ตลาด","next":"เขาเห็นน้ำในคลอง",
            "ownerReason":"เติมทางเชื่อมเหตุการณ์"}}
        with mock.patch.object(svc,"_table",return_value=memory):
            for edits in ({"reviewedByOwner":False},{"issue":"made-up"},
                          {"original":"a"*1201},{"revised":""},{"previous":"z"*1001}):
                request=json.loads(json.dumps(valid))
                request["lesson"].update(edits)
                status,_=data(svc._story_lesson(request))
                self.assertEqual(status,400)
            status,result=data(svc._story_lesson(valid))
        self.assertEqual(status,200)
        self.assertTrue(result["saved"])
        self.assertFalse(result["trained"])
        self.assertEqual(len(memory.rows),1)
        self.assertEqual(memory.rows[0]["pk"],svc.STORY_PK)
        self.assertEqual(memory.rows[0]["status"],"editorial-memory-only")
        self.assertFalse(memory.rows[0]["record"]["usedForWeightTraining"])

    def test_story_lessons_api_is_paginated_and_separated_from_repetition(self):
        record={"issue":"clarity","original":"ประโยคเก่า","revised":"ประโยคแก้"}
        class Table:
            calls=[]
            def query(self,**kwargs):
                self.calls.append(kwargs)
                if len(self.calls)==1:
                    return {"Items":[{"pk":svc.STORY_PK,"sk":"lesson#001700000000#00000000-0000-4000-8000-000000000001",
                      "record":record,"status":"editorial-memory-only"}],
                      "LastEvaluatedKey":{"pk":svc.STORY_PK,"sk":"lesson#001700000000#00000000-0000-4000-8000-000000000001"}}
                return {"Items":[]}
        stub=Table()
        sys.modules.setdefault("boto3",__import__("types").ModuleType("boto3"))
        sys.modules.setdefault("boto3.dynamodb",__import__("types").ModuleType("boto3.dynamodb"))
        module=__import__("types").ModuleType("boto3.dynamodb.conditions")
        module.Key=KeyStub
        with mock.patch.dict(sys.modules,{"boto3.dynamodb.conditions":module}),\
             mock.patch.object(svc,"_table",return_value=stub):
            status,out=data(svc._story_lessons({"limit":1}))
            self.assertEqual(status,200)
            self.assertEqual(out["lessons"][0]["issue"],"clarity")
            self.assertFalse(out["trained"])
            self.assertTrue(out["nextCursor"])
            status,out=data(svc._story_lessons({"limit":1,"cursor":out["nextCursor"]}))
            self.assertEqual(status,200)
            self.assertEqual(out["lessons"],[])
            self.assertEqual(stub.calls[1]["ExclusiveStartKey"]["pk"],svc.STORY_PK)
        for bad in ({"limit":False},{"limit":81},{"cursor":"active"},{"cursor":"lesson#bad"}):
            status,_=data(svc._story_lessons(bad))
            self.assertEqual(status,400)
if __name__=="__main__":unittest.main()
