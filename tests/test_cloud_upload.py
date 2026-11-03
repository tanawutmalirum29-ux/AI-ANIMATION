"""Regression tests for 293-scene, 320 KB+ resumable AI Mother uploads."""
import json
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "autodub"))
import cloud_jobs
import cloud_upload
import teacher


class Conflict(Exception):
    response = {"Error": {"Code": "ConditionalCheckFailedException"}}


class Table:
    def __init__(self):
        self.rows = {}
        self.writes = 0

    def get_item(self, Key, **kwargs):
        row = self.rows.get((Key["pk"], Key["sk"]))
        return {"Item": row} if row else {}

    def put_item(self, Item, ConditionExpression=None, **kwargs):
        key = (Item["pk"], Item["sk"])
        if ConditionExpression and key in self.rows:
            raise Conflict()
        self.rows[key] = dict(Item)
        self.writes += 1


def decoded(reply):
    return reply["statusCode"], json.loads(reply["body"])


def examples(n=293):
    # 1200 Thai codepoints per scene: > 320 KB for 293 scenes.
    return [{"id": "s%04d" % i, "episodeId": "ep%02d" % (i // 12),
             "text": "แสง" * 400, "previous": "รุ่งเช้า" * 22,
             "next": "วันต่อมา" * 24, "studentIssue": "review"}
            for i in range(n)]


def prepared(table, scenes, owner="225819900", upload_id="a" * 32):
    body = {"uploadId": upload_id, "projectId": "story293",
            "provider": "gemini", "totalScenes": len(scenes)}
    with mock.patch.object(cloud_jobs, "_table", return_value=table), \
         mock.patch.object(teacher, "_status", return_value=teacher._response(200, {
             "feedbackReady": True,
             "providers": [{"id": "gemini", "ready": True, "model": "free"}]})):
        reply = cloud_upload.handle("teacher.job.upload.prepare", body, owner)
    assert reply["statusCode"] == 200, reply
    return body, json.loads(reply["body"])


class UploadTests(unittest.TestCase):
    def test_293_large_thai_scenes_validate_and_chunk(self):
        scenes = examples()
        raw_bytes = len(json.dumps(scenes, ensure_ascii=False).encode("utf-8"))
        self.assertGreater(raw_bytes, 320_000)
        self.assertEqual(len(cloud_jobs._validated_scenes(scenes)), 293)
        table = Table()
        body, start = prepared(table, scenes)
        self.assertEqual(start["partCount"], 19)
        self.assertEqual(start["uploadedParts"], [])
        parts = [scenes[i:i + 16] for i in range(0, len(scenes), 16)]
        # A commit before all uploads must NEVER trigger an AI job.
        with mock.patch.object(cloud_jobs, "_table", return_value=table), \
             mock.patch.object(cloud_jobs, "_start") as begin:
            code, reply = decoded(cloud_upload.handle("teacher.job.upload.commit", body, "225819900"))
            self.assertEqual(code, 409)
            self.assertIn(0, reply["missingParts"])
            begin.assert_not_called()
        with mock.patch.object(cloud_jobs, "_table", return_value=table):
            for i, part in enumerate(parts):
                status, result = decoded(cloud_upload.handle(
                    "teacher.job.upload.chunk",
                    {"uploadId": body["uploadId"], "partIndex": i, "scenes": part},
                    "225819900"))
                self.assertEqual(status, 200, result)
        resume, snapshot = prepared(table, scenes)
        self.assertEqual(snapshot["uploadedParts"], list(range(19)))
        self.assertEqual(snapshot["chunkSize"], 16)
        with mock.patch.object(cloud_jobs, "_table", return_value=table), \
             mock.patch.object(cloud_jobs, "_start", return_value=cloud_jobs._resp(
                 200, {"job": {"jobId": "cloud-293"}, "existing": False})) as start_fn:
            result_code, result = decoded(cloud_upload.handle(
                "teacher.job.upload.commit", body, "225819900"))
            self.assertEqual(result_code, 200)
            self.assertEqual(result["job"]["jobId"], "cloud-293")
            submitted = start_fn.call_args.args[0]
            self.assertEqual(len(submitted["scenes"]), 293)
            self.assertEqual(submitted["scenes"][292]["id"], "s0292")
            self.assertEqual(start_fn.call_args.args[1], "225819900")

    def test_upload_resume_and_immutable_repeat(self):
        scenes = examples(18)
        table = Table()
        body, start = prepared(table, scenes)
        self.assertEqual(start["partCount"], 2)
        with mock.patch.object(cloud_jobs, "_table", return_value=table):
            payload = {"uploadId": body["uploadId"],
                       "partIndex": 0, "scenes": scenes[:16]}
            first = decoded(cloud_upload.handle("teacher.job.upload.chunk", payload, "225819900"))
            again = decoded(cloud_upload.handle("teacher.job.upload.chunk", payload, "225819900"))
            self.assertEqual(first[0], 200)
            self.assertFalse(first[1]["alreadyUploaded"])
            self.assertTrue(again[1]["alreadyUploaded"])
            self.assertEqual(len(table.rows), 2)  # manifest + first chunk
            modified = [{**x, "text": "ใหม่" + x["text"][4:]} for x in scenes[:16]]
            code, _ = decoded(cloud_upload.handle("teacher.job.upload.chunk",
                {**payload, "scenes": modified}, "225819900"))
            self.assertEqual(code, 409)
        _, resumed = prepared(table, scenes)
        self.assertEqual(resumed["uploadedParts"], [0])

    def test_owner_and_missing_chunks_fail_closed(self):
        scenes = examples(17)
        table = Table()
        body, _ = prepared(table, scenes)
        with mock.patch.object(cloud_jobs, "_table", return_value=table), \
             mock.patch.object(cloud_jobs, "_start") as start:
            for action in ("teacher.job.upload.chunk", "teacher.job.upload.commit"):
                bad = {"uploadId": body["uploadId"], "partIndex": 0,
                       "scenes": scenes[:16]}
                status, _ = decoded(cloud_upload.handle(action, bad, "other-owner"))
                self.assertEqual(status, 404)
            start.assert_not_called()
        with mock.patch.object(cloud_jobs, "_table", return_value=table):
            result = decoded(cloud_upload.handle("teacher.job.upload.chunk", {
                "uploadId": body["uploadId"], "partIndex": 1, "scenes": scenes[:16]}, "225819900"))
            self.assertEqual(result[0], 400)

    def test_cross_part_duplicate_scene_ids_rejected_before_start(self):
        scenes = examples(17)
        scenes[-1]["id"] = scenes[0]["id"]
        table = Table()
        body, _ = prepared(table, scenes)
        with mock.patch.object(cloud_jobs, "_table", return_value=table):
            for i, part in enumerate((scenes[:16], scenes[16:])):
                status, _ = decoded(cloud_upload.handle("teacher.job.upload.chunk", {
                    "uploadId": body["uploadId"], "partIndex": i, "scenes": part
                }, "225819900"))
                self.assertEqual(status, 200)
        with mock.patch.object(cloud_jobs, "_table", return_value=table), \
             mock.patch.object(cloud_jobs, "_start") as start:
            status, _ = decoded(cloud_upload.handle(
                "teacher.job.upload.commit", body, "225819900"))
            self.assertEqual(status, 400)
            start.assert_not_called()

    def test_invalid_counts_guard_before_dynamodb(self):
        for total in (0, 351, 3.5, True, "293"):
            with mock.patch.object(cloud_jobs, "_table", side_effect=AssertionError("not reached")):
                code, _ = decoded(cloud_upload._prepare({
                    "uploadId": "a" * 32, "projectId": "story293",
                    "provider": "gemini", "totalScenes": total}, "225819900"))
                self.assertEqual(code, 400)


if __name__ == "__main__":
    unittest.main()
