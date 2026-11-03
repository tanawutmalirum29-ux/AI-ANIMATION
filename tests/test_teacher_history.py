"""Read-only AWS teacher history and CPU training-progress contract."""
import base64,json,os,sys,types,unittest
from decimal import Decimal
from unittest import mock
sys.path.insert(0,os.path.join(os.path.dirname(__file__),"..","autodub"))
import teacher,story_auto_train as train

class Key:
    def __init__(self,name):self.name=name
    def eq(self,*args):return self
    def __and__(self,*args):return self
    def begins_with(self,*args):return self

class FakeTable:
    def __init__(self,records):
        self.records=records
        self.calls=[]
    def query(self,**params):
        self.calls.append(params)
        if params.get("Limit")==1:
            return {"Items":[]}
        page=[r for r in self.records if r["sk"].startswith("teach#")]
        if params.get("ExclusiveStartKey"):
            marker=params["ExclusiveStartKey"]["sk"]
            page=[r for r in page if r["sk"]<marker]
        limit=params.get("Limit",100)
        selected=page[:limit]
        return {"Items":selected,
                **({"LastEvaluatedKey":{"pk":train.PK,"sk":selected[-1]["sk"]}}
                   if len(page)>limit else {})}
    def put_item(self,**kwargs):raise AssertionError("reading history must not mutate DynamoDB")

def aws(table):
    boto=types.ModuleType("boto3")
    boto.resource=lambda name:types.SimpleNamespace(Table=lambda n:table)
    cond=types.ModuleType("boto3.dynamodb.conditions");cond.Key=Key
    dynamodb=types.ModuleType("boto3.dynamodb");dynamodb.conditions=cond
    return mock.patch.dict(sys.modules,{"boto3":boto,
      "boto3.dynamodb":dynamodb,"boto3.dynamodb.conditions":cond})
def unpack(value):
    return value["statusCode"],json.loads(value["body"])

def saved(i):
    return {"pk":train.PK,"sk":"teach#"+format(300-i,"064x"),
       "status":"teacher-qa-approved","createdAt":1762137000+i,
       "record":{"projectId":"story123","episodeId":"ep1","sceneId":"s"+str(i),
         "original":"ข้อความต้นฉบับลำดับ "+str(i),
         "revised":"ข้อความแก้ลำดับ "+str(i),
         "teacherReason":"อธิบายให้สอดคล้องกับเหตุและผลของเรื่อง",
         "issue":"continuity","source":"teacher-owner-delegated-qa",
         "ownerDelegatedTraining":True,"trainingEligible":True,
         "qa":{"structurePassed":True},"reviewedByOwner":False}}

class HistoryTests(unittest.TestCase):
    def test_dynamodb_decimal_lesson_metadata_serializes_in_history_and_memory(self):
        # boto3 returns DynamoDB Number attributes as Decimal, not int/float.
        # Previously teacher._response raised TypeError before any AI work began.
        row = saved(0)
        row["createdAt"] = Decimal("1762137000")
        row["record"]["qa"]["repairAttempts"] = Decimal("2")
        row["record"]["qa"]["confidence"] = Decimal("0.75")
        table = FakeTable([row])
        with aws(table), mock.patch.dict(os.environ, {"TEACHER_FEEDBACK_TABLE": "test"}):
            memory_code, memory = unpack(teacher._auto_lessons({"limit": 30}))
            history_code, history = unpack(teacher._lesson_history({"limit": 30}))
        self.assertEqual(memory_code, 200)
        self.assertEqual(history_code, 200)
        self.assertEqual(memory["lessons"][0]["qa"]["repairAttempts"], 2)
        self.assertEqual(memory["lessons"][0]["qa"]["confidence"], 0.75)
        self.assertEqual(history["items"][0]["createdAt"], 1762137000)

    def test_teacher_history_returns_real_saved_lessons_not_old_manual_feedback(self):
        table=FakeTable([saved(0),saved(1),{"pk":train.PK,
          "sk":"teach#"+format(299,"064x"),
          "record":{"sceneId":"pending"},"status":"teacher-retry-queued"}])
        with aws(table),mock.patch.dict(os.environ,{"TEACHER_FEEDBACK_TABLE":"test"}):
            code,data=unpack(teacher._lesson_history({"limit":30}))
        self.assertEqual(code,200)
        self.assertEqual(len(data["items"]),2)
        self.assertTrue(all(item["trainingEligible"] for item in data["items"]))
        self.assertFalse(any(item["reviewedByOwner"] for item in data["items"]))
        self.assertTrue(data["items"][0]["original"].startswith("ข้อความต้นฉบับ"))
        self.assertFalse(data["trainedWeights"])
        self.assertNotIn("nextCursorAvailable",data)

    def test_paginated_history_can_retrieve_141_scenes(self):
        records=[saved(i) for i in range(141)]
        table=FakeTable(records)
        rows,cursor=[],None
        with aws(table),mock.patch.dict(os.environ,{"TEACHER_FEEDBACK_TABLE":"test"}):
            for _ in range(5):
                args={"limit":60}
                if cursor:args["cursor"]=cursor
                code,page=unpack(teacher._lesson_history(args))
                self.assertEqual(code,200)
                rows.extend(page["items"])
                cursor=page["nextCursor"]
                if not cursor:break
        self.assertEqual(len(rows),141)
        self.assertEqual(len({r["sceneId"] for r in rows}),141)
        self.assertIsNone(cursor)
        self.assertTrue(all("ExclusiveStartKey" in q for q in table.calls[1:]))

    def test_reject_tampered_cursor_without_query_or_secret(self):
        table=FakeTable([])
        for cursor in ("abc",base64.urlsafe_b64encode(
                json.dumps({"pk":"secrets","sk":"teach#"+("0"*64)}).encode()
                ).decode().rstrip("=")):
            with aws(table),mock.patch.dict(os.environ,{"TEACHER_FEEDBACK_TABLE":"test"}):
                code,_=unpack(teacher._lesson_history({"cursor":cursor}))
            self.assertEqual(code,400)
        self.assertEqual(table.calls,[])

    def test_read_only_training_status_shows_gathering_not_fake_model(self):
        table=FakeTable([saved(i) for i in range(20)])
        with aws(table),mock.patch.dict(os.environ,{"TEACHER_FEEDBACK_TABLE":"test"}):
            code,result=unpack(train.status())
        self.assertEqual(code,200)
        self.assertEqual(result["counts"]["projects"],1)
        self.assertEqual(result["counts"]["rows"],20)
        self.assertFalse(result["readyForTraining"])
        self.assertIsNone(result["activeVersion"])
        self.assertEqual(result["models"],[])
        self.assertTrue(result["notGenerative"])

if __name__=="__main__":unittest.main()
