#!/usr/bin/env bash
# AWS CloudShell: bash deploy.sh https://main.d1wc6w01kiwpnk.amplifyapp.com
# First run prompts for a website password. Re-runs preserve the password.
# To rotate, export SITE_PASSWORD securely before re-running.
set -euo pipefail
umask 077
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-ap-southeast-2}}"
FN="${STORY_STUDIO_LAMBDA_NAME:-story-studio-autodub}"
ROLE="story-studio-autodub-role"
ORIGIN="${1:-https://main.d1wc6w01kiwpnk.amplifyapp.com}"
HERE="$(cd "$(dirname "$0")" && pwd)"
export AWS_DEFAULT_REGION="$REGION"
if [[ ! "$ORIGIN" =~ ^https://[a-zA-Z0-9.-]+/?$ ]];then echo "Invalid HTTPS origin" >&2;exit 1;fi
ORIGIN="${ORIGIN%/}"
OLD_ENV="$(mktemp)" NEW_ENV="$(mktemp)"
trap 'rm -f "$OLD_ENV" "$NEW_ENV"; unset SITE_PASSWORD || true' EXIT
echo '{}' > "$OLD_ENV"
if aws lambda get-function --function-name "$FN" >/dev/null 2>&1;then
 aws lambda get-function-configuration --function-name "$FN" --query 'Environment.Variables' --output json > "$OLD_ENV"
fi
HAS_PASSWORD="$(python3 - "$OLD_ENV" <<'PY'
import json,sys
d=json.load(open(sys.argv[1])) or {}
print("yes" if all(d.get(k) for k in ("SITE_PASSWORD_HASH","SITE_PASSWORD_SALT","SESSION_SECRET")) else "no")
PY
)"
if [[ -z "${SITE_PASSWORD:-}" && "$HAS_PASSWORD" != yes ]];then
 if [[ ! -t 0 ]];then echo "CloudShell must be interactive for the first password setup" >&2;exit 1;fi
 echo "ตั้งรหัสผ่านเว็บไซต์ใหม่ (12 ตัวอักษรขึ้นไป)"
 read -rs -p "รหัสผ่าน: " SITE_PASSWORD; echo
 read -rs -p "ยืนยันรหัสผ่าน: " CONFIRM; echo
 if [[ "$SITE_PASSWORD" != "$CONFIRM" ]];then echo "รหัสผ่านไม่ตรงกัน" >&2;exit 1;fi
 unset CONFIRM
fi
if [[ -n "${SITE_PASSWORD:-}" && ${#SITE_PASSWORD} -lt 12 ]];then echo "รหัสสั้นเกินไป" >&2;exit 1;fi
export SITE_PASSWORD="${SITE_PASSWORD:-}"
python3 - "$OLD_ENV" "$NEW_ENV" <<'PY'
import os,sys,json,secrets,hashlib
env=json.load(open(sys.argv[1])) or {}
env.setdefault("DUB_KEY",secrets.token_urlsafe(32))
password=os.environ.get("SITE_PASSWORD","")
if password:
    salt=secrets.token_bytes(24)
    env["SITE_PASSWORD_SALT"]=salt.hex()
    env["SITE_PASSWORD_HASH"]=hashlib.pbkdf2_hmac("sha256",password.encode(),salt,260000).hex()
env.setdefault("SESSION_SECRET",secrets.token_urlsafe(48))
if not all(env.get(k) for k in ("SITE_PASSWORD_HASH","SITE_PASSWORD_SALT","SESSION_SECRET")):
    raise SystemExit("ยังไม่ได้ตั้งรหัสผ่านเว็บไซต์")
with open(sys.argv[2],"w") as f:json.dump({"Variables":env},f)
PY
unset SITE_PASSWORD
echo "[1/6] แพ็ก Lambda ..."
rm -rf "$HERE/build" "$HERE/autodub.zip";mkdir -p "$HERE/build"
python3 -m pip install --quiet --upgrade --target "$HERE/build" --platform manylinux2014_x86_64 --python-version 3.12 --implementation cp --only-binary=:all: edge-tts
cp "$HERE/handler.py" "$HERE/build/"
cp "$HERE/github_assets.py" "$HERE/build/"
python3 - "$HERE" <<'PY'
import os,sys,zipfile
root=os.path.join(sys.argv[1],"build")
with zipfile.ZipFile(os.path.join(sys.argv[1],"autodub.zip"),"w",zipfile.ZIP_DEFLATED) as z:
 for d,_,fs in os.walk(root):
  for f in fs:
   p=os.path.join(d,f);z.write(p,os.path.relpath(p,root))
PY
echo "[2/6] เตรียม IAM role ..."
if ! aws iam get-role --role-name "$ROLE" >/dev/null 2>&1;then
 aws iam create-role --role-name "$ROLE" --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
 aws iam attach-role-policy --role-name "$ROLE" --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
 sleep 12
fi
ROLE_ARN="$(aws iam get-role --role-name "$ROLE" --query Role.Arn --output text)"
echo "[3/6] ติดตั้ง Lambda ..."
if aws lambda get-function --function-name "$FN" >/dev/null 2>&1;then
 aws lambda update-function-code --function-name "$FN" --zip-file "fileb://$HERE/autodub.zip" >/dev/null
 aws lambda wait function-updated --function-name "$FN"
 aws lambda update-function-configuration --function-name "$FN" --runtime python3.12 --timeout 30 --memory-size 256 --environment "file://$NEW_ENV" >/dev/null
 aws lambda wait function-updated --function-name "$FN"
else
 aws lambda create-function --function-name "$FN" --runtime python3.12 --architectures x86_64 --handler handler.handler --role "$ROLE_ARN" --timeout 30 --memory-size 256 --zip-file "fileb://$HERE/autodub.zip" --environment "file://$NEW_ENV" >/dev/null
 aws lambda wait function-active-v2 --function-name "$FN"
fi
echo "[4/6] ตั้ง Function URL + CORS ..."
CORS="$(python3 - "$ORIGIN" <<'PY'
import json,sys
print(json.dumps({"AllowOrigins":[sys.argv[1]],"AllowMethods":["POST"],"AllowHeaders":["content-type","authorization","x-dub-key"],"MaxAge":86400}))
PY
)"
if aws lambda get-function-url-config --function-name "$FN" >/dev/null 2>&1;then
 aws lambda update-function-url-config --function-name "$FN" --auth-type NONE --cors "$CORS" >/dev/null
else
 aws lambda create-function-url-config --function-name "$FN" --auth-type NONE --cors "$CORS" >/dev/null
fi
aws lambda add-permission --function-name "$FN" --statement-id UrlInvokeUrl --action lambda:InvokeFunctionUrl --principal '*' --function-url-auth-type NONE >/dev/null 2>&1 || true
aws lambda add-permission --function-name "$FN" --statement-id UrlInvokeFunction --action lambda:InvokeFunction --principal '*' --invoked-via-function-url >/dev/null 2>&1 || true
URL="$(aws lambda get-function-url-config --function-name "$FN" --query FunctionUrl --output text)"
echo "[5/6] ตั้ง Amplify API URL + เริ่ม Deploy ..."
export STORY_STUDIO_API_URL="$URL" STORY_STUDIO_ORIGIN="$ORIGIN"
python3 <<'PY'
import os,re
m=re.match(r"^https://([a-zA-Z0-9-]+)\.([a-zA-Z0-9]+)\.amplifyapp\.com$",os.environ["STORY_STUDIO_ORIGIN"])
if not m:
 print("Custom domain: please configure STORY_STUDIO_API_URL in Amplify manually.")
else:
 branch,app_id=m.groups()
 try:
  import boto3
  client=boto3.client("amplify")
  app=client.get_app(appId=app_id)["app"]
  values=app.get("environmentVariables") or {}
  values["STORY_STUDIO_API_URL"]=os.environ["STORY_STUDIO_API_URL"]
  client.update_app(appId=app_id,environmentVariables=values)
  print("Amplify configuration saved:",app_id,branch)
  try:
   job=client.start_job(appId=app_id,branchName=branch,jobType="RELEASE")
   print("Amplify deploy started:",job["jobSummary"]["jobId"])
  except Exception as exc:
   print("Redeploy manually in AWS Amplify:",type(exc).__name__)
 except Exception as exc:
  print("Amplify auto-setup unavailable:",type(exc).__name__)
  print("Set STORY_STUDIO_API_URL in Amplify environment variables and redeploy.")
PY
unset STORY_STUDIO_API_URL STORY_STUDIO_ORIGIN
echo "[6/6] ตรวจว่ารหัสผิดถูกปฏิเสธ ..."
HTTP="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$URL" -H 'content-type: application/json' -d '{"action":"login","password":"_invalid_check_"}' || true)"
echo "Wrong-password test HTTP: $HTTP (expected 401)"
echo "Website: $ORIGIN"
echo "Public API URL (not a secret): $URL"
echo "เมื่อ Amplify Deploy เสร็จ ให้เปิดเว็บและใช้รหัสผ่านเว็บไซต์ที่ตั้งไว้"
