"""Persistent AWS teacher keys and explicit disconnect contract."""
import os,sys,json,unittest
from unittest import mock
sys.path.insert(0,os.path.join(os.path.dirname(__file__),"..","autodub"))
import teacher

def unpack(response):
    return response["statusCode"],json.loads(response["body"])

class TeacherConnectionTests(unittest.TestCase):
    def test_keys_survive_status_refresh_without_ever_being_returned(self):
        saved={"gemini":{"key":"long_secret_api_key_abcdef","model":"gemini-3.5-flash-lite"},
               "openrouter":{"key":"another_private_secret_key","model":"openrouter/free"}}
        with mock.patch.object(teacher,"_settings",return_value=saved):
            code,result=unpack(teacher._status())
            code2,second=unpack(teacher._status())
        self.assertEqual(code,200)
        self.assertEqual(code2,200)
        self.assertEqual(result,second)
        self.assertTrue(next(p for p in result["providers"] if p["id"]=="gemini")["ready"])
        self.assertNotIn("long_secret",json.dumps(result))
        self.assertNotIn("another_private",json.dumps(result))

    def test_key_can_be_reused_if_model_is_changed_and_blank_api_key_sent(self):
        settings={"gemini":{"key":"long_secret_api_key_abcdef","model":"gemini-2.5-flash"}}
        saved=[]
        with mock.patch.object(teacher,"_settings",return_value=settings),\
             mock.patch.object(teacher,"_save_settings",side_effect=saved.append),\
             mock.patch.dict(os.environ,{"TEACHER_SETTINGS_PARAMETER":"/test/teacher"}):
            code,result=unpack(teacher._configure({
             "provider":"gemini","model":"gemini-3.5-flash-lite","apiKey":""}))
        self.assertEqual(code,200)
        self.assertTrue(result["ok"])
        self.assertEqual(saved[0]["gemini"]["key"],"long_secret_api_key_abcdef")

    def test_explicit_disconnect_only_selected_provider(self):
        settings={"gemini":{"key":"long_secret_api_key_abcdef","model":"gemini-3.5-flash-lite"},
                  "openrouter":{"key":"another_private_secret_key","model":"openrouter/free"}}
        written=[]
        with mock.patch.object(teacher,"_settings",return_value=settings),\
             mock.patch.object(teacher,"_save_settings",side_effect=written.append),\
             mock.patch.dict(os.environ,{"TEACHER_SETTINGS_PARAMETER":"/test/teacher"}):
            code,result=unpack(teacher._disconnect({"provider":"gemini","confirmDisconnect":True}))
        self.assertEqual(code,200)
        self.assertTrue(result["disconnected"])
        self.assertNotIn("gemini",written[0])
        self.assertEqual(written[0]["openrouter"]["key"],"another_private_secret_key")
        self.assertNotIn("secret",json.dumps(result))

    def test_disconnect_requires_confirmation(self):
        with mock.patch.object(teacher,"_save_settings") as save:
            code,result=unpack(teacher._disconnect({"provider":"gemini"}))
        self.assertEqual(code,400)
        save.assert_not_called()

if __name__=="__main__":
    unittest.main()
