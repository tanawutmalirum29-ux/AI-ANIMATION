"""Regression tests: scalable owner vault retained after sandbox and pool rollback."""
import json
import os
import sys
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "autodub"))
sys.path.insert(0, os.path.dirname(__file__))
import owner_key_vault as vault
import teacher_connections as connections
import cloud_jobs
import teacher
from test_cloud_jobs import Table, fixture


def read(reply):
    return reply["statusCode"], json.loads(reply["body"])


class VaultTable:
    def __init__(self):
        self.rows = {}

    def query(self, **kwargs):
        # All rows belong to the admin vault partition in this fake.
        data = [dict(x) for (pk, _), x in self.rows.items()
                if pk == vault.PK]
        data.sort(key=lambda x: x["sk"])
        cursor = kwargs.get("ExclusiveStartKey")
        if cursor:
            data = [x for x in data if x["sk"] > cursor["sk"]]
        page = data[:kwargs.get("Limit", 100)]
        result = {"Items": page}
        if len(data) > len(page):
            result["LastEvaluatedKey"] = {"pk": vault.PK, "sk": page[-1]["sk"]}
        return result

    def get_item(self, Key, **kwargs):
        row = self.rows.get((Key["pk"], Key["sk"]))
        return {"Item": dict(row)} if row else {}

    def put_item(self, Item, **kwargs):
        pk = (Item["pk"], Item["sk"])
        if pk in self.rows:
            raise AssertionError("duplicate id")
        self.rows[pk] = dict(Item)

    def update_item(self, Key, **kwargs):
        row = self.rows[(Key["pk"], Key["sk"])]
        assert row["status"] == "active"
        row["status"] = "revoked"
        for field in ("nonce", "encrypted", "fingerprint"):
            row.pop(field, None)


class OwnerVaultTests(unittest.TestCase):
    def setUp(self):
        self.db = VaultTable()
        self.env = mock.patch.dict(os.environ, {
            "TEACHER_FEEDBACK_TABLE": "test-teacher-table",
            "TEACHER_OWNER_VAULT_V2": "1",
            "SESSION_SECRET": "the-stable-lambda-session-secret-is-long-enough-0123456789"})
        self.env.start()
        self.table_patch = mock.patch.object(vault, "_table", return_value=self.db)
        self.table_patch.start()

    def tearDown(self):
        self.table_patch.stop()
        self.env.stop()

    def test_more_than_six_encrypted_keys_and_no_secrets_in_list(self):
        for i in range(9):
            result = vault.add("gemini", "gemini-3.5-flash-lite", "",
                               "long-owner-key-secret-" + str(i))
            self.assertTrue(result["id"].startswith("key-"))
        visible = vault.listing()
        self.assertEqual(len(visible), 9)
        for i in range(9):
            raw = "long-owner-key-secret-" + str(i)
            self.assertNotIn(raw, json.dumps(visible))
            self.assertNotIn(raw, json.dumps(list(self.db.rows.values())))
        first = visible[0]
        self.assertTrue(vault.resolve(first["provider"], first["id"])["key"].startswith("long-owner"))
        self.assertEqual(vault.resolve("openrouter", first["id"]), {})
        self.assertFalse(vault.resolve("gemini", "key-" + "0" * 16))
        with self.assertRaisesRegex(ValueError, "duplicate-key"):
            vault.add("gemini", "gemini-3.5-flash-lite", "", "long-owner-key-secret-0")

    def test_revoked_material_cannot_be_resolved(self):
        key = vault.add("gemini", "gemini-3.5-flash-lite", "", "long-owner-key-revoke")
        self.assertTrue(vault.remove(key["id"]))
        self.assertEqual(vault.resolve("gemini", key["id"]), {})
        row = self.db.rows[(vault.PK, "connection#" + key["id"])]
        self.assertNotIn("encrypted", row)
        self.assertNotIn("nonce", row)
        self.assertNotIn("fingerprint", row)

    def test_connection_module_uses_vault_and_keeps_legacy_ssm_untouched(self):
        settings = {"gemini": {"key": "legacy-long-key-secret-01234",
                                "model": "gemini-3.5-flash-lite"}}
        with mock.patch.object(teacher, "_settings", return_value=settings), \
             mock.patch.object(teacher, "_save_settings",
                               side_effect=AssertionError("must not rewrite old SSM")):
            for i in range(8):
                code, result = read(connections.add({
                    "provider": "gemini", "apiKey": "new-owner-key-secret-" + str(i),
                    "model": "gemini-3.5-flash-lite"}, connections.ADMIN_ID))
                self.assertEqual(code, 200, result)
            listed = connections.listing()
            self.assertEqual(len(listed), 9)
            self.assertEqual(len(settings), 1)
            added = next(x for x in listed if x["id"].startswith("key-"))
            self.assertTrue(connections.resolve(settings, added["provider"], added["id"])["key"])
            code, result = read(connections.handle(
                "teacher.connection.list", {}, connections.ADMIN_ID))
            self.assertEqual(code, 200)
            self.assertIsNone(result["maxExtra"])
            self.assertNotIn("new-owner-key-secret", json.dumps(result))
            with mock.patch.object(cloud_jobs, "_connection_in_use", return_value=False):
                code, _ = read(connections.remove({
                    "connectionId": added["id"], "confirmRemove": True}, connections.ADMIN_ID))
            self.assertEqual(code, 200)

    def test_key_cannot_be_removed_while_pool_has_unfinished_job(self):
        key = vault.add("gemini", "gemini-3.5-flash-lite", "", "pool-job-owner-key-secret")
        with mock.patch.object(teacher, "_settings", return_value={}), \
             mock.patch.object(cloud_jobs, "_connection_in_use", return_value=True):
            code, _ = read(connections.remove({
                "connectionId": key["id"], "confirmRemove": True}, connections.ADMIN_ID))
        self.assertEqual(code, 409)
        self.assertTrue(vault.resolve("gemini", key["id"])["key"])



if __name__ == '__main__':
    unittest.main()
