"""Provider HTTP 404 diagnostics and free-only model repair contract tests."""
import copy
import json
import os
import sys
import unittest
from unittest import mock
sys.path.insert(0,os.path.join(os.path.dirname(__file__),"..","autodub"))
import teacher

def unpack(result):
    return result["statusCode"],json.loads(result["body"])

class ModelRepairTests(unittest.TestCase):
    def test_unavailable_gemini_model_yields_specific_safe_diagnostic(self):
        with mock.patch.object(teacher,"_settings",return_value={
            "gemini":{"model":"gemini-2.5-flash","key":"private-DO-NOT-LOG"}}),\
             mock.patch.object(teacher,"_post_json",
               side_effect=ValueError("AI provider returned HTTP 404")):
            status,result=unpack(teacher._model_test({"provider":"gemini"}))
        self.assertEqual(status,404)
        self.assertEqual(result["reasonCode"],"TEACHER_MODEL_UNAVAILABLE")
        self.assertEqual(result["model"],"gemini-2.5-flash")
        self.assertEqual(result["suggestedModel"],"gemini-3.5-flash-lite")
        self.assertNotIn("private-DO-NOT-LOG",json.dumps(result))

    def test_openrouter_404_suggests_only_free_router(self):
        with mock.patch.object(teacher,"_settings",return_value={
            "openrouter":{"model":"google/gemma-3-27b-it:free","key":"private-DO-NOT-LOG"}}),\
             mock.patch.object(teacher,"_post_json",
               side_effect=ValueError("AI provider returned HTTP 404")):
            status,result=unpack(teacher._model_test({"provider":"openrouter"}))
        self.assertEqual(status,404)
        self.assertEqual(result["suggestedModel"],"openrouter/free")
        self.assertNotIn("private-DO-NOT-LOG",json.dumps(result))

    def test_owner_selected_openrouter_model_reuses_key_without_price_tier_gate(self):
        saved=[]
        with mock.patch.object(teacher,"_settings",return_value={"openrouter":{
             "model":"google/gemma-3-27b-it:free","key":"old-private-key"}}),\
             mock.patch.object(teacher,"_save_settings",
                               side_effect=lambda value: saved.append(copy.deepcopy(value))),\
             mock.patch.dict(os.environ,{"TEACHER_SETTINGS_PARAMETER":"/test/teacher-key",
                                      "TEACHER_ALLOW_PAID_MODELS":"0"}):
            status,result=unpack(teacher._configure({"provider":"openrouter",
                                                     "model":"openrouter/free","apiKey":""}))
            selected,_=unpack(teacher._configure({"provider":"openrouter",
                                                 "model":"openai/gpt-4o","apiKey":""}))
        self.assertEqual(status,200)
        self.assertTrue(result["ok"])
        self.assertEqual(saved[0]["openrouter"]["key"],"old-private-key")
        self.assertEqual(saved[0]["openrouter"]["model"],"openrouter/free")
        self.assertEqual(selected,200)
        self.assertEqual(len(saved),2)
        self.assertEqual(saved[1]["openrouter"]["key"],"old-private-key")
        self.assertEqual(saved[1]["openrouter"]["model"],"openai/gpt-4o")

    def test_429_does_not_look_like_an_unavailable_model(self):
        with mock.patch.object(teacher,"_settings",return_value={
            "gemini":{"model":"gemini-3.5-flash-lite","key":"secret"}}),\
             mock.patch.object(teacher,"_post_json",
                side_effect=ValueError("AI provider returned HTTP 429")):
            code,result=unpack(teacher._model_test({"provider":"gemini"}))
        self.assertEqual(code,429)
        self.assertEqual(result["reasonCode"],"TEACHER_PROVIDER_RATE_LIMIT")

    def test_live_probe_success_returns_provider_model_without_leaking_reply(self):
        response={"candidates":[{"content":{"parts":[{"text":'{"reply":"OK","ops":[]}'}]}}]}
        with mock.patch.object(teacher,"_settings",return_value={
            "gemini":{"model":"gemini-3.5-flash-lite","key":"secret"}}),\
             mock.patch.object(teacher,"_post_json",return_value=response):
            code,result=unpack(teacher._model_test({"provider":"gemini"}))
        self.assertEqual(code,200)
        self.assertTrue(result["ready"])
        self.assertEqual(result["model"],"gemini-3.5-flash-lite")
        self.assertNotIn("reply",result)

if __name__=="__main__":
    unittest.main()
