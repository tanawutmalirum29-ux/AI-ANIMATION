"""Cursor pagination tests for Studio student memory (no AWS/network)."""
import json
import os
import re
import sys
import types
import unittest
from unittest import mock
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "autodub"))
import student_learning as student

class FakeKey:
    def __init__(self, name): self.name=name
    def eq(self, other): return self
    def begins_with(self, other): return self
    def __and__(self, other): return self

class FakeTable:
    def __init__(self, rows):
        self.rows=rows
        self.calls=[]
    def query(self, **kwargs):
        self.calls.append(kwargs)
        cursor=kwargs.get("ExclusiveStartKey")
        start=0
        if cursor:
            matches=[i for i,row in enumerate(self.rows) if row["sk"]==cursor["sk"]]
            if not matches:
                raise ValueError("unknown cursor")
            start=matches[0]+1
        limit=kwargs["Limit"]
        page=self.rows[start:start+limit]
        result={"Items":page}
        if start+limit<len(self.rows):
            result["LastEvaluatedKey"]={"pk":student.PK,"sk":page[-1]["sk"]}
        return result

def decode(result):
    return result["statusCode"],json.loads(result["body"])

def make_row(i,status="approved-for-training"):
    ident="lesson#%012d#00000000-0000-4000-8000-%012d"%(1700000000+i,i)
    return {"pk":student.PK,"sk":ident,"status":status,"createdAt":1700000000+i,
        "record":{"text":"คำซ้ำทดสอบ "+str(i),"label":"keep",
                  "projectId":"story123","teacherReason":"ควรเก็บคำซ้ำ"}}

class MemoryPageTests(unittest.TestCase):
    def test_invalid_cursor_and_limits_rejected_without_db(self):
        for options in ({"cursor":"active"},{"cursor":"lesson#wrong"},
                        {"limit":True},{"limit":151},{"limit":0}):
            status,_=decode(student._lessons(options))
            self.assertEqual(status,400)

    def test_keyset_pagination_returns_all_unique_records_and_dates(self):
        table=FakeTable([make_row(1),make_row(2),make_row(3)])
        fake=types.ModuleType("boto3.dynamodb.conditions")
        fake.Key=FakeKey
        with mock.patch.dict(sys.modules,{"boto3.dynamodb.conditions":fake}), \
             mock.patch.object(student,"_table",return_value=table):
            status,first=decode(student._lessons({"limit":2}))
            self.assertEqual(status,200)
            self.assertEqual(len(first["lessons"]),2)
            self.assertEqual(first["lessons"][0]["createdAt"],1700000001)
            self.assertIsNotNone(first["nextCursor"])
            status,second=decode(student._lessons({"limit":2,"cursor":first["nextCursor"]}))
            self.assertEqual(status,200)
            self.assertEqual(len(second["lessons"]),1)
            self.assertIsNone(second["nextCursor"])
            self.assertEqual(len({v["id"] for v in first["lessons"]+second["lessons"]}),3)
            self.assertEqual(table.calls[1]["ExclusiveStartKey"]["pk"],student.PK)
            self.assertEqual(table.calls[0]["ScanIndexForward"],False)

    def test_only_approved_training_records_are_returned(self):
        table=FakeTable([make_row(1),make_row(2,"rejected"),make_row(3)])
        fake=types.ModuleType("boto3.dynamodb.conditions")
        fake.Key=FakeKey
        with mock.patch.dict(sys.modules,{"boto3.dynamodb.conditions":fake}), \
             mock.patch.object(student,"_table",return_value=table):
            status,result=decode(student._lessons({"limit":10}))
            self.assertEqual(status,200)
            self.assertEqual(len(result["lessons"]),2)
            self.assertTrue(all(x["label"]=="keep" for x in result["lessons"]))
            self.assertEqual(result["pageLimit"],10)

if __name__=="__main__":
    unittest.main()
