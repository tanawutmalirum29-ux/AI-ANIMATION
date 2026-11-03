"""Regression for AWS Worker ClientError after Memory-First deploy.

The Cloud Jobs IAM policy grants DynamoDB GetItem, not BatchGetItem. A denied
batch read must never interrupt a resumable training job or silently force
more AI provider usage. In particular, the existing 82/293 checkpoint survives.
"""
import json
import os
import sys
import types
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "autodub"))
sys.path.insert(0, os.path.dirname(__file__))
import teacher
import cloud_jobs
from test_cloud_jobs import Table, fixture
from test_teacher_memory_fastpath import example, lesson, PK


class Denied(Exception):
    response = {"Error": {"Code": "AccessDeniedException",
                          "Message": "Sensitive AWS ARN/role details must not be shown"}}
    operation_name = "BatchGetItem"


class Throttled(Exception):
    response = {"Error": {"Code": "ProvisionedThroughputExceededException"}}
    operation_name = "BatchGetItem"


class ClientErrorRecoveryTests(unittest.TestCase):
    def test_default_memory_path_only_needs_existing_get_item_permission(self):
        table = Table([])
        table.name = "story-studio-teacher-feedback"
        scene = example(82)
        key = teacher._scene_key("story123", scene)
        table.put_item(Item={"pk": PK, "sk": key,
                             "status": "teacher-qa-approved",
                             "record": lesson(scene)})
        # Even with a table.name and a potentially available SDK API,
        # default lookup must not attempt BatchGetItem at all.
        with mock.patch.dict(os.environ, {"TEACHER_MEMORY_BATCH_GET": "0"}), \
             mock.patch("boto3.resource", side_effect=AssertionError("batch resource must not be used")):
            result = teacher._cached_scene_records(table, "story123", [scene])
        self.assertEqual(result[scene["id"]]["original"], scene["text"])

    def test_batch_get_access_denied_falls_back_to_consistent_get_item(self):
        table = Table([])
        table.name = "story-studio-teacher-feedback"
        scenes = [example(i) for i in range(16)]
        for scene in scenes:
            table.put_item(Item={"pk": PK,
                                 "sk": teacher._scene_key("story123", scene),
                                 "status": "teacher-qa-approved",
                                 "record": lesson(scene)})
        calls = []
        original_get = table.get_item
        def checked_get_item(*args, **kwargs):
            calls.append(kwargs)
            if not kwargs.get("ConsistentRead"):
                raise AssertionError("A fallback read cannot be eventually consistent")
            return original_get(*args, **kwargs)
        table.get_item = checked_get_item
        fake = types.SimpleNamespace(
            batch_get_item=mock.Mock(side_effect=Denied()))
        found = teacher._cached_scene_records(table, "story123", scenes, dynamodb=fake)
        self.assertEqual(len(found), 16)
        self.assertEqual(len(calls), 16)
        self.assertEqual(fake.batch_get_item.call_count, 1)

    def test_other_ddb_errors_propagate_and_never_relabel_as_cache_miss(self):
        table = Table([])
        table.name = "story-studio-teacher-feedback"
        fake = types.SimpleNamespace(batch_get_item=mock.Mock(side_effect=Throttled()))
        with self.assertRaises(Throttled):
            teacher._cached_scene_records(table, "story123", [example(0)], dynamodb=fake)

    def test_resumed_82_of_293_keeps_checkpoint_and_uses_prior_memory(self):
        table, jobid, _ = fixture()
        scenes = [example(i) for i in range(293)]
        job = table.rows[("teacher-job#" + jobid, "meta")]
        job.update({"state": "queued", "generation": 1,
                    "total": 293, "work": list(range(293)), "position": 82,
                    "completedIndices": list(range(82)), "saved": 0, "reused": 82,
                    "lastError": "", "leaseUntil": 0})
        for start in range(0, 293, 16):
            table.rows[("teacher-job#" + jobid, "input#%05d" % (start // 16))] = {
                "pk": "teacher-job#" + jobid, "sk": "input#%05d" % (start // 16),
                "scenes": scenes[start:start + 16]}
        for index in range(82, 98):
            scene = scenes[index]
            table.rows[(PK, teacher._scene_key("story123", scene))] = {
                "pk": PK, "sk": teacher._scene_key("story123", scene),
                "status": "teacher-qa-approved", "record": lesson(scene)}
        with mock.patch.object(cloud_jobs, "_table", return_value=table), \
             mock.patch.object(teacher, "_auto_teach",
                               side_effect=AssertionError("must not use provider")) as ai:
            result = cloud_jobs.worker({"jobId": jobid, "generation": 1})
        self.assertTrue(result["next"])
        self.assertEqual(result["waitSeconds"], 1)
        ai.assert_not_called()
        saved_job = table.rows[("teacher-job#" + jobid, "meta")]
        self.assertEqual(saved_job["position"], 98)
        self.assertEqual(len(saved_job["completedIndices"]), 98)
        self.assertEqual(saved_job["saved"], 0)
        self.assertEqual(saved_job["reused"], 98)
        self.assertIn(("teacher-job#" + jobid, "result#00097"), table.rows)

    def test_exception_codes_are_safe_and_next_failed_job_remains_resumable(self):
        table, jobid, _ = fixture()
        self.assertEqual(
            cloud_jobs._safe_worker_error(Denied()),
            "AWS Worker: Denied / AccessDeniedException / BatchGetItem")
        self.assertNotIn("Sensitive", cloud_jobs._safe_worker_error(Denied()))
        with mock.patch.object(cloud_jobs, "_table", return_value=table), \
             mock.patch.object(teacher, "_cached_scene_records", side_effect=Denied()):
            result = cloud_jobs.worker({"jobId": jobid, "generation": 0})
        self.assertEqual(result["state"], "needs-attention")
        saved_job = table.rows[("teacher-job#" + jobid, "meta")]
        self.assertEqual(saved_job["state"], "needs-attention")
        self.assertEqual(saved_job["position"], 0)
        self.assertIn("AccessDeniedException", saved_job["lastError"])
        self.assertIn("BatchGetItem", saved_job["lastError"])


if __name__ == "__main__":
    unittest.main()
