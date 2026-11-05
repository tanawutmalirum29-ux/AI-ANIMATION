"""Rendered QA links follow the same signed owner gate as video downloads."""
import io,json,os,sys,types,unittest
from unittest import mock
import test_member_editor_access as base

class QAAccessTests(unittest.TestCase):
    def test_qa_download_uses_export_owner_gate_and_old_jobs_still_work(self):
        class S3(base.FakeS3):
            def get_object(self,**kw):
                if kw['Key'] not in self.records:raise base.FakeClientError('NoSuchKey')
                return {'Body':io.BytesIO(self.records[kw['Key']]['Body'])}
            def generate_presigned_url(self,operation,Params,ExpiresIn):
                return 'https://s3.example.invalid/'+Params['Key']
        class Build(base.FakeBuild):
            def batch_get_builds(self,ids):return {'builds':[{'buildStatus':'SUCCEEDED'}]}
        s3=S3();botocore=types.ModuleType('botocore');exceptions=types.ModuleType('botocore.exceptions');exceptions.ClientError=base.FakeClientError;botocore.exceptions=exceptions
        boto3=types.ModuleType('boto3');boto3.client=lambda name:Build()
        with mock.patch.dict(os.environ,base.ENV),mock.patch.dict(sys.modules,{'boto3':boto3,'botocore':botocore,'botocore.exceptions':exceptions}),mock.patch.object(base.handler,'_export_s3_client',return_value=s3):
            token,_=base.github_oauth.issue_session({'id':11,'login':'member'})
            other,_=base.github_oauth.issue_session({'id':12,'login':'other'})
            status,reply=base.parse(base.handler.handler(base.event('export.prepare',token),None));self.assertEqual(status,200)
            jid=reply['jobId'];prefix='jobs/'+jid+'/'
            s3.records[prefix+'build.json']={'Body':b'{"id":"test-build"}'}
            s3.records[prefix+'result.mp4']={}
            for has_qa in [False,True]:
                if has_qa:s3.records[prefix+'render-qa.json']={}
                status,reply=base.parse(base.handler.handler(base.event('export.status',token,jobId=jid),None));self.assertEqual(status,200);self.assertEqual(reply['state'],'SUCCEEDED')
                self.assertEqual('qaUrl' in reply,has_qa)
                if has_qa:self.assertTrue(reply['qaUrl'].endswith('/render-qa.json'))
                status,reply=base.parse(base.handler.handler(base.event('export.status',other,jobId=jid),None));self.assertEqual(status,403);self.assertNotIn('qaUrl',reply)

if __name__=='__main__':unittest.main()
