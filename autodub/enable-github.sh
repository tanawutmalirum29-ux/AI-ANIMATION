#!/usr/bin/env bash
# Connect the Story Studio Lambda to the single allowed GitHub repository.
# Use a fine-grained PAT scoped ONLY to tanawutmalirum29-ux/AI-ANIMATION:
# Repository contents: Read and write; Pull requests: Read and write.
# Run this in AWS CloudShell AFTER deploy.sh; token never enters the browser or Git.
set -euo pipefail
umask 077
export AWS_DEFAULT_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-ap-southeast-2}}"
FN="${STORY_STUDIO_LAMBDA_NAME:-story-studio-autodub}"
TMP="$(mktemp)"
trap 'rm -f "$TMP"; unset GITHUB_ASSET_TOKEN || true' EXIT
echo 'GitHub fine-grained PAT: Repo AI-ANIMATION, Contents RW, Pull requests RW'
if [[ -t 0 ]]; then
 read -r -s -p "วาง GitHub token (ซ่อนการพิมพ์): " GITHUB_ASSET_TOKEN
 echo
else
 if [[ -z "${GITHUB_ASSET_TOKEN:-}" ]]; then echo "ต้องกรอก token ใน CloudShell หรือส่งผ่านตัวแปรสภาพแวดล้อม" >&2;exit 1;fi
fi
if [[ ! "$GITHUB_ASSET_TOKEN" =~ ^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$ ]]; then
 echo "รูปแบบ token ไม่ถูกต้อง" >&2;exit 1
fi
export GITHUB_ASSET_TOKEN
if ! aws lambda get-function --function-name "$FN" >/dev/null 2>&1;then
 echo "ไม่พบ Lambda; กรุณารัน deploy.sh ก่อน" >&2;exit 1
fi
aws lambda get-function-configuration --function-name "$FN" --query 'Environment.Variables' --output json > "$TMP.old"
trap 'rm -f "$TMP" "$TMP.old"; unset GITHUB_ASSET_TOKEN || true' EXIT
python3 - "$TMP.old" "$TMP" <<'PY'
import json,os,sys
env=json.load(open(sys.argv[1])) or {}
if not all(env.get(k) for k in ("SITE_PASSWORD_HASH","SITE_PASSWORD_SALT","SESSION_SECRET")):
 raise SystemExit("ยังไม่ได้ตั้งรหัสเว็บไซต์ ต้องรัน deploy.sh ก่อน")
env["GITHUB_ASSET_TOKEN"]=os.environ["GITHUB_ASSET_TOKEN"]
with open(sys.argv[2],"w") as f:json.dump({"Variables":env},f)
PY
unset GITHUB_ASSET_TOKEN
aws lambda update-function-configuration --function-name "$FN" --environment "file://$TMP" >/dev/null
aws lambda wait function-updated --function-name "$FN"
echo "เชื่อม GitHub Asset PR สำเร็จ (token ถูกเก็บใน Lambda เท่านั้น)"
echo "ไปที่หน้า AI Workspace → คลังของสำเร็จรูป → ส่ง PR ได้หลังล็อกอินเว็บไซต์"
