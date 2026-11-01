"""Verify the real Lambda signer produces regional SigV4 S3 URLs (no AWS calls)."""
import importlib.util
import os
import pathlib
import sys
import types
from urllib.parse import parse_qs, urlsplit
from unittest.mock import patch

# Handler imports Edge TTS at module load, but a signed URL test needs no TTS.
sys.modules["edge_tts"] = types.SimpleNamespace(Communicate=object)
root = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root / "autodub"))
spec = importlib.util.spec_from_file_location("cloud_export_lambda", root / "autodub" / "handler.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with patch.dict(os.environ, {
    "AWS_REGION": "ap-southeast-2",
    "AWS_DEFAULT_REGION": "ap-southeast-2",
    "AWS_ACCESS_KEY_ID": "offline-test-key",
    "AWS_SECRET_ACCESS_KEY": "offline-test-secret",
    "AWS_EC2_METADATA_DISABLED": "true",
}):
    client = module._export_s3_client()
    bucket = "story-cloud-export-offline-ap-southeast-2"
    key = "jobs/00000000-0000-4000-8000-000000000001/input.json"
    put = client.generate_presigned_url("put_object", Params={
        "Bucket": bucket, "Key": key, "ContentType": "application/json"
    }, ExpiresIn=1800)
    get = client.generate_presigned_url("get_object", Params={
        "Bucket": bucket, "Key": "jobs/00000000-0000-4000-8000-000000000001/result.mp4"
    }, ExpiresIn=900)

for name, url in (("PUT", put), ("GET", get)):
    parts = urlsplit(url)
    params = parse_qs(parts.query)
    assert parts.scheme == "https", (name, parts.scheme)
    assert parts.netloc == f"{bucket}.s3.ap-southeast-2.amazonaws.com", (name, parts.netloc)
    assert params.get("X-Amz-Algorithm") == ["AWS4-HMAC-SHA256"], (name, params.keys())
    assert "/ap-southeast-2/s3/aws4_request" in params["X-Amz-Credential"][0]
    assert "AWSAccessKeyId" not in params, "Never fall back to Signature V2"
assert parse_qs(urlsplit(put).query)["X-Amz-SignedHeaders"] == ["content-type;host"]
print("PASS Cloud Export: browser upload and download URLs use regional S3 SigV4, no global redirects")
