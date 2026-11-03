"""GitHub-bound member key vault, AES-GCM isolation and immutable public v1."""
import json
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "autodub"))
import member_keys
import member_ai


class FakeTable:
    def __init__(self):
        self.rows = {}
        self.calls = []

    def query(self, KeyConditionExpression, **kwargs):
        expr = KeyConditionExpression.get_expression()
        pk = expr["values"][1]
        return {"Items": [row.copy() for (p, _), row in self.rows.items()
                          if p == pk]}

    def get_item(self, Key, **kwargs):
        row = self.rows.get((Key["pk"], Key["sk"]))
        return {"Item": dict(row)} if row else {}

    def put_item(self, Item, ConditionExpression=None, **kwargs):
        key = (Item["pk"], Item["sk"])
        if ConditionExpression and key in self.rows:
            raise AssertionError("duplicate item")
        self.rows[key] = dict(Item)
        self.calls.append(("put", key))

    def update_item(self, Key, ExpressionAttributeValues, **kwargs):
        row = self.rows[(Key["pk"], Key["sk"])]
        if row.get("status") != ExpressionAttributeValues[":active"]:
            raise AssertionError("must revoke active key")
        row["status"] = "revoked"
        row["updatedAt"] = ExpressionAttributeValues[":now"]
        row.pop("nonce", None)
        row.pop("encrypted", None)
        row.pop("fingerprint", None)
        self.calls.append(("revoke", (Key["pk"], Key["sk"])))


def read(response):
    return response["statusCode"], json.loads(response["body"])


class MemberKeyTests(unittest.TestCase):
    def setUp(self):
        self.table = FakeTable()
        self.env = mock.patch.dict(os.environ, {
            "SESSION_SECRET": "this-is-a-stable-secret-of-adequate-entropy-123456789",
            "TEACHER_FEEDBACK_TABLE": "ai-feedback"})
        self.env.start()
        self.table_patch = mock.patch.object(member_keys, "_table",
                                              return_value=self.table)
        self.table_patch.start()
        self.a = {"sub": 101, "login": "alpha", "role": "member"}
        self.b = {"sub": 202, "login": "beta", "role": "member"}

    def tearDown(self):
        self.table_patch.stop()
        self.env.stop()

    def save(self, user, key, provider="gemini"):
        status, result = read(member_keys.handle("member.keys.add", {
            "provider": provider, "apiKey": key}, user))
        self.assertEqual(status, 200, result)
        return result["connection"]

    def test_relogin_same_github_id_recovers_own_key_but_other_member_cannot(self):
        raw = "member-a-api-token-very-secret"
        saved = self.save(self.a, raw)
        self.assertNotIn(raw, json.dumps(list(self.table.rows.values())))
        self.assertNotIn(raw, json.dumps(saved))
        first = member_keys.resolve(self.a, saved["id"])
        self.assertEqual(first["apiKey"], raw)
        relogin = {"sub": 101, "login": "renamed-alpha", "role": "member"}
        listing = read(member_keys.list_keys(relogin))[1]
        self.assertEqual(listing["connections"][0]["id"], saved["id"])
        self.assertEqual(listing["account"]["githubUserId"], "101")
        self.assertIsNone(member_keys.resolve(self.b, saved["id"]))
        self.assertEqual(read(member_keys.list_keys(self.b))[1]["connections"], [])
        self.assertEqual(self.table.rows[("member-api-vault#101", "key#" + saved["id"])]["status"], "active")

    def test_key_is_authenticated_and_encrypted_using_own_aad(self):
        saved = self.save(self.a, "another-member-secret-key")
        a = self.table.rows[("member-api-vault#101", "key#" + saved["id"])]
        b = self.save(self.b, "beta-super-private-api-key")
        other = self.table.rows[("member-api-vault#202", "key#" + b["id"])]
        # Even after moving a ciphertext manually, it cannot decrypt with
        # another signed identity or connection ID as authenticated data.
        other["nonce"], other["encrypted"] = a["nonce"], a["encrypted"]
        with self.assertRaises(ValueError):
            member_keys.resolve(self.b, b["id"])

    def test_remove_wipes_secret_material_but_preserves_audit_tombstone(self):
        saved = self.save(self.a, "erase-this-raw-api-key-please")
        cid = saved["id"]
        code, result = read(member_keys.handle("member.keys.remove", {
            "connectionId": cid, "confirmRemove": True}, self.a))
        self.assertEqual(code, 200, result)
        row = self.table.rows[("member-api-vault#101", "key#" + cid)]
        self.assertEqual(row["status"], "revoked")
        self.assertNotIn("encrypted", row)
        self.assertNotIn("nonce", row)
        self.assertNotIn("fingerprint", row)
        self.assertIsNone(member_keys.resolve(self.a, cid))
        self.assertEqual(read(member_keys.list_keys(self.a))[1]["connections"], [])

    def test_duplicate_keys_are_rejected_per_user_not_globally(self):
        key = "duplicate-usable-provider-key-456"
        self.save(self.a, key)
        code, _ = read(member_keys.add({"provider": "gemini", "apiKey": key}, self.a))
        self.assertEqual(code, 409)
        self.save(self.b, key)
        result = read(member_keys.list_keys(self.b))[1]
        self.assertEqual(len(result["connections"]), 1)

    def test_member_only_and_free_model_validation(self):
        admin = {"sub": 225819900, "login": "owner", "role": "admin"}
        code, _ = read(member_keys.handle("member.keys.list", {}, admin))
        self.assertEqual(code, 403)
        for bad in ("vendor/paid-model", "vendor/paid:pro", "model name"):
            code, _ = read(member_keys.add({
                "provider": "openrouter", "model": bad,
                "apiKey": "long-secret-for-provider-123"}, self.a))
            self.assertEqual(code, 400)
        code, _ = read(member_keys.add({
            "provider": "openrouter", "model": "vendor/free:free",
            "apiKey": "long-secret-for-provider-123"}, self.a))
        self.assertEqual(code, 200)

    def test_six_specialist_roles_are_one_frozen_release_not_six_weight_models(self):
        status, catalog = read(member_ai.catalog())
        self.assertEqual(status, 200)
        self.assertEqual(catalog["release"], "member-six-v1")
        self.assertEqual(catalog["moduleCount"], 6)
        self.assertEqual(len(catalog["modules"]), 6)
        self.assertFalse(catalog["trainedSeparateWeights"])
        self.assertFalse(catalog["autoUpgrades"])
        for item in catalog["modules"]:
            self.assertFalse(item["trainedWeights"])
            self.assertIn(item["id"], member_ai.ROLES)

    def test_saved_legacy_member_key_is_not_accepted_by_hosted_inference(self):
        saved = self.save(self.a, "legacy-key")
        for user in (self.a, self.b):
            code, _ = read(member_ai.run({
                "role": "voice", "connectionId": saved["id"],
                "message": "วรรคตอน"}, user))
            self.assertEqual(code, 403)


if __name__ == "__main__":
    unittest.main()
