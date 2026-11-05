"""Multimodal review contract, using JPEG fixture and mocked provider."""
import base64
import json
import sys
import types
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "autodub"))
import teacher_vision as vision

def response(status, payload):
    return {"statusCode":status,"body":json.dumps(payload)}

class VisionTest(unittest.TestCase):
    def setUp(self):
        self.previous_teacher = sys.modules.get("teacher")
        self.previous_connections = sys.modules.get("teacher_connections")
        sys.modules["teacher"] = types.SimpleNamespace(
            _response=response, _settings=lambda: {},
            PROVIDERS=("gemini", "openrouter", "compatible"))
        sys.modules["teacher_connections"] = types.SimpleNamespace(ADMIN_ID="owner")
        self.connection = vision.__dict__.get("_call")
        self.payload = {"provider":"gemini","connectionId":"default-gemini",
                        "frame":"data:image/jpeg;base64,"+
                           base64.b64encode(b"\xff\xd8"+b"0"*240).decode(),
                        "scene":{"id":"scene-1","camera":{"from":1},"actors":[]}}
    def tearDown(self):
        if self.previous_teacher is None: sys.modules.pop("teacher",None)
        else: sys.modules["teacher"]=self.previous_teacher
        if self.previous_connections is None: sys.modules.pop("teacher_connections",None)
        else: sys.modules["teacher_connections"]=self.previous_connections
        vision._call=self.connection

    def test_owner_gate_invalid_frame_and_oversize(self):
        self.assertEqual(vision.handle(self.payload,"not-owner")["statusCode"],403)
        self.assertEqual(vision.handle({**self.payload,"frame":"not a JPEG"},"owner")["statusCode"],400)

    def test_bound_patch_to_camera_lights_and_small_actor_moves(self):
        patch=vision._safe_patch({"camera":{"from":1.1,"world":10,"javascript":"bad"},
              "lighting":{"exposure":1.15,"glow":-.2},
              "actorMoves":[{"index":0,"dx":3,"dy":-1},
                            {"index":0,"dx":900,"dy":0},
                            {"index":"0","dx":1,"dy":1}],
              "notes":"ตรวจมุมกล้อง"})
        self.assertEqual(patch["camera"],{"from":1.1})
        self.assertEqual(patch["lighting"],{"exposure":1.15})
        self.assertEqual(patch["actorMoves"],[{"index":0,"dx":3,"dy":-1}])
        self.assertNotIn("javascript",patch)

    def test_response_follows_verified_image_and_never_autowrites(self):
        import teacher_production
        previous_conn=teacher_production._connection
        teacher_production._connection=lambda _:{"key":"REDACTED","model":"test-vision"}
        vision._call=lambda *args:{
          "summary":"ตัวละครเล็กเกินไป","issues":["ควรขยับกล้อง"],
          "patch":{"camera":{"from":1.1},"lighting":{"exposure":1.08}}}
        try:
            result=vision.handle(self.payload,"owner")
            self.assertEqual(result["statusCode"],200)
            body=json.loads(result["body"])
            self.assertTrue(body["observedFrame"])
            self.assertFalse(body["applied"])
            self.assertEqual(body["patch"]["camera"]["from"],1.1)
        finally:
            teacher_production._connection=previous_conn

if __name__=="__main__":unittest.main()
