"""Memory-first AI Teacher: 16 prior QA scenes per AWS step, no provider token use."""
import json
import os
import sys
import types
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "autodub"))
import teacher
import cloud_jobs
from test_cloud_jobs import Table, fixture

PK = "learning#teacher-story-coherence"


def example(index):
    return {"id": "ep1-s%02d" % index, "episodeId": "ep1",
            "text": "ฝนเริ่มตกก่อนทุกคนกลับบ้านฉากที่%d" % index,
            "previous": "ชาวบ้านเตรียมเดินทาง", "next": "พระอาทิตย์ขึ้น",
            "studentIssue": "keep"}


def lesson(scene, project="story123"):
    return {"projectId": project, "sceneId": scene["id"],
            "episodeId": scene["episodeId"], "original": scene["text"],
            "revised": scene["text"], "previous": scene["previous"],
            "next": scene["next"], "issue": "keep",
            "teacherReason": "บทเดิมตรงตามเหตุการณ์ในเรื่องและไม่ต้องเปลี่ยน"}


def prepared(n=16, remembered=range(16)):
    table, jobid, _ = fixture()
    scenes = [example(i) for i in range(n)]
    job = table.rows[("teacher-job#" + jobid, "meta")]
    job["work"] = list(range(n))
    job["total"] = n
    table.rows[("teacher-job#" + jobid, "input#00000")]["scenes"] = scenes
    for index in remembered:
        scene = scenes[index]
        key = teacher._scene_key("story123", scene)
        table.put_item(Item={"pk": PK, "sk": key, "status": "teacher-qa-approved",
                             "record": lesson(scene)})
    return table, jobid, scenes


def unpack(resp):
    return resp["statusCode"], json.loads(resp["body"])


class MemoryFastPathTests(unittest.TestCase):
    def test_cloud_worker_reuses_sixteen_approved_lessons_without_model(self):
        table, jobid, scenes = prepared()
        import story_auto_train
        cpu = {"body": json.dumps({"status": "not-ready",
                                   "activated": False, "counts": {}})}
        with mock.patch.object(cloud_jobs, "_table", return_value=table), \
             mock.patch.object(teacher, "_auto_teach", side_effect=AssertionError(
                 "no AI calls on cache hit")) as ai, \
             mock.patch.object(story_auto_train, "train", return_value=cpu):
            out = cloud_jobs.worker({"jobId": jobid, "generation": 0})
        self.assertEqual(out["state"], "completed")
        self.assertFalse(out["next"])
        ai.assert_not_called()
        item = table.rows[("teacher-job#" + jobid, "meta")]
        self.assertEqual(item["saved"], 0)
        self.assertEqual(item["reused"], 16)
        self.assertEqual(item["completedIndices"], list(range(16)))
        self.assertEqual(len([k for k in table.rows if k[1].startswith("result#")]), 16)

    def test_one_batch_processes_fourteen_memories_plus_two_fresh(self):
        table, jobid, scenes = prepared(16, remembered=range(14))
        import story_auto_train
        teacher_reply = teacher._response(200, {
            "saved": 2, "reused": 0,
            "lessons": [lesson(s) for s in scenes[14:]]})
        cpu = {"body": json.dumps({"status": "not-ready", "activated": False, "counts": {}})}
        with mock.patch.object(cloud_jobs, "_table", return_value=table), \
             mock.patch.object(teacher, "_auto_teach", return_value=teacher_reply) as ai, \
             mock.patch.object(story_auto_train, "train", return_value=cpu):
            out = cloud_jobs.worker({"jobId": jobid, "generation": 0})
        self.assertEqual(out["state"], "completed")
        self.assertEqual(ai.call_count, 1)
        self.assertEqual([x["id"] for x in ai.call_args.args[0]["scenes"]],
                         [scenes[14]["id"], scenes[15]["id"]])
        item = table.rows[("teacher-job#" + jobid, "meta")]
        self.assertEqual(item["saved"], 2)
        self.assertEqual(item["reused"], 14)
        self.assertEqual(len(item["completedIndices"]), 16)

    def test_limit_to_two_new_scenes_even_with_long_lookahead(self):
        table, jobid, scenes = prepared(16, remembered=range(3, 16))
        reply = teacher._response(200, {
            "saved": 2, "reused": 0, "lessons": [lesson(s) for s in scenes[:2]]})
        with mock.patch.object(cloud_jobs, "_table", return_value=table), \
             mock.patch.object(teacher, "_auto_teach", return_value=reply) as ai:
            first = cloud_jobs.worker({"jobId": jobid, "generation": 0})
        self.assertTrue(first["next"])
        self.assertEqual(first["waitSeconds"], 12)
        self.assertEqual(table.rows[("teacher-job#" + jobid, "meta")]["position"], 2)
        ai.assert_called_once()

    def test_exact_matching_rejects_changed_context_and_nonqa_memory(self):
        table, jobid, scenes = prepared(2, remembered=range(2))
        original = scenes[0]
        identical = {**original}
        changed = {**original, "next": "เปลี่ยนเนื้อเรื่องสำคัญ"}
        found = teacher._cached_scene_records(table, "story123", [identical])
        self.assertEqual(list(found), [original["id"]])
        self.assertEqual(teacher._cached_scene_records(table, "story123", [changed]), {})
        self.assertEqual(teacher._cached_scene_records(table, "otherproject", [identical]), {})
        key = teacher._scene_key("story123", scenes[1])
        table.rows[(PK, key)]["status"] = "teacher-retry-queued"
        self.assertEqual(teacher._cached_scene_records(table, "story123", [scenes[1]]), {})

    def test_batch_get_reads_many_at_once_with_retries_and_no_duplicate_keys(self):
        table, _, scenes = prepared(16)
        reads = []
        fake = types.SimpleNamespace()
        def batch_get_item(RequestItems):
            reads.append(RequestItems)
            lookup = RequestItems["mytable"]["Keys"]
            # UnprocessedKeys are retried (rather than interpreted as misses).
            if len(reads) == 1:
                first, rest = lookup[:8], lookup[8:]
                return {"Responses": {"mytable": [
                    table.get_item(Key=k)["Item"] for k in first]},
                    "UnprocessedKeys": {"mytable": {
                        "Keys": rest, "ConsistentRead": True}}}
            return {"Responses": {"mytable": [
                table.get_item(Key=k)["Item"] for k in lookup]}}
        fake.batch_get_item = batch_get_item
        table.name = "mytable"
        with mock.patch("teacher.time.sleep") as sleep:
            result = teacher._cached_scene_records(table, "story123", scenes, dynamodb=fake)
        self.assertEqual(len(result), 16)
        self.assertEqual(len(reads), 2)
        self.assertTrue(all(x["mytable"]["ConsistentRead"] for x in reads))
        sleep.assert_called_once()


if __name__ == "__main__":
    unittest.main()
