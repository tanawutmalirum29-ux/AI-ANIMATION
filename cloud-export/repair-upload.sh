#!/usr/bin/env bash
# AWS CloudShell: update only the export API + S3 upload policy, not CodeBuild.
set -euo pipefail
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-ap-southeast-2}}"
export AWS_DEFAULT_REGION="$REGION"
ORIGIN="${1:-https://main.d1wc6w01kiwpnk.amplifyapp.com}"
ORIGIN="${ORIGIN%/}"
if [[ ! "$ORIGIN" =~ ^https://[A-Za-z0-9.-]+$ ]];then echo "Provide an HTTPS website origin" >&2;exit 1;fi
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FN="${STORY_STUDIO_LAMBDA_NAME:-story-studio-autodub}"
BUCKET="$(aws lambda get-function-configuration --function-name "$FN" --region "$REGION" --query 'Environment.Variables.CLOUD_EXPORT_BUCKET' --output text)"
if [[ -z "$BUCKET" || "$BUCKET" == None ]];then echo "Cloud Export is not installed in Lambda $FN ($REGION)" >&2;exit 1;fi

echo "[1/3] Update Lambda: regional S3 SigV4 signing"
bash "$ROOT/autodub/deploy.sh" "$ORIGIN"

echo "[2/3] Repair S3 CORS for $ORIGIN"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
python3 - "$TMP" "$ORIGIN" <<'PY'
import json,sys
path,origin=sys.argv[1:]
with open(path,"w") as f:
 json.dump({"CORSRules":[{"AllowedOrigins":[origin],"AllowedMethods":["PUT"],
 "AllowedHeaders":["*"],"ExposeHeaders":["ETag"],"MaxAgeSeconds":3600}]},f)
PY
aws s3api put-bucket-cors --bucket "$BUCKET" --region "$REGION" --cors-configuration "file://$TMP"

echo "[3/3] Test regional SigV4 URL and real browser-style S3 preflight"
python3 - "$BUCKET" "$ORIGIN" "$REGION" <<'PY'
import os,sys,urllib.request,urllib.error
from urllib.parse import urlsplit,parse_qs
import boto3
from botocore.config import Config
bucket,origin,region=sys.argv[1:]
s3=boto3.client("s3",region_name=region,config=Config(signature_version="s3v4",s3={"addressing_style":"virtual"}))
url=s3.generate_presigned_url("put_object",Params={"Bucket":bucket,
 "Key":"jobs/00000000-0000-4000-8000-000000000001/cors-test.json","ContentType":"application/json"},ExpiresIn=120)
parsed=urlsplit(url)
if parsed.hostname!=bucket+".s3."+region+".amazonaws.com":
 raise SystemExit("S3 URL has an incorrect Region/host; no browser upload attempted")
if parse_qs(parsed.query).get("X-Amz-Algorithm")!=["AWS4-HMAC-SHA256"]:
 raise SystemExit("S3 URL is not using AWS SigV4")
req=urllib.request.Request(url,method="OPTIONS",headers={
 "Origin":origin,"Access-Control-Request-Method":"PUT",
 "Access-Control-Request-Headers":"content-type"})
try:
 with urllib.request.urlopen(req,timeout=15) as response:
  allowed=response.headers.get("Access-Control-Allow-Origin","")
  if allowed!=origin:
   raise SystemExit("S3 CORS did not authorize the website origin: "+repr(allowed))
  print("PASS regional S3 SigV4 + CORS preflight (HTTP "+str(response.status)+")")
except urllib.error.HTTPError as error:
 raise SystemExit("S3 preflight rejected (HTTP "+str(error.code)+"); verify S3 CORS and region")
except urllib.error.URLError as error:
 raise SystemExit("Cannot reach S3 preflight: "+str(error.reason))
PY
echo "Cloud upload repair complete. Reload the website and retry a short export."
