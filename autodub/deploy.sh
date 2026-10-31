#!/usr/bin/env bash
# ติดตั้ง Lambda พากย์อัตโนมัติ — รันใน AWS CloudShell (เปิดจากเบราว์เซอร์/มือถือได้ ไม่ต้องมีคอม)
# วิธีใช้:  bash deploy.sh                (CORS เปิดทุกโดเมน ป้องกันด้วยรหัสลับ)
#           bash deploy.sh https://main.xxxx.amplifyapp.com   (จำกัดเฉพาะโดเมนเว็บของคุณ)
# รันซ้ำได้: อัปเดตโค้ดเดิมและใช้รหัสลับเดิม
set -euo pipefail

REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-ap-southeast-1}}"
FN="story-studio-autodub"
ROLE="story-studio-autodub-role"
ORIGIN="${1:-*}"
HERE="$(cd "$(dirname "$0")" && pwd)"
export AWS_DEFAULT_REGION="$REGION"

echo "[1/6] เตรียมแพ็กเกจ (edge-tts) ..."
rm -rf "$HERE/build" "$HERE/autodub.zip"
mkdir -p "$HERE/build"
python3 -m pip install --quiet --upgrade --target "$HERE/build" \
  --platform manylinux2014_x86_64 --python-version 3.12 --implementation cp \
  --only-binary=:all: edge-tts
cp "$HERE/handler.py" "$HERE/build/"
python3 - "$HERE" <<'PY'
import os, sys, zipfile
root = os.path.join(sys.argv[1], "build")
with zipfile.ZipFile(os.path.join(sys.argv[1], "autodub.zip"), "w", zipfile.ZIP_DEFLATED) as z:
    for d, _, files in os.walk(root):
        for f in files:
            p = os.path.join(d, f)
            z.write(p, os.path.relpath(p, root))
PY

echo "[2/6] สิทธิ์ (IAM role) ..."
if ! aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  aws iam create-role --role-name "$ROLE" --assume-role-policy-document \
    '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  aws iam attach-role-policy --role-name "$ROLE" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  echo "      รอสิทธิ์พร้อมใช้งาน 12 วินาที ..."
  sleep 12
fi
ROLE_ARN="$(aws iam get-role --role-name "$ROLE" --query Role.Arn --output text)"

echo "[3/6] สร้าง/อัปเดต Lambda ..."
if aws lambda get-function --function-name "$FN" >/dev/null 2>&1; then
  KEY="${DUB_KEY:-$(aws lambda get-function-configuration --function-name "$FN" --query 'Environment.Variables.DUB_KEY' --output text)}"
  aws lambda update-function-code --function-name "$FN" --zip-file "fileb://$HERE/autodub.zip" >/dev/null
  aws lambda wait function-updated --function-name "$FN"
  aws lambda update-function-configuration --function-name "$FN" \
    --runtime python3.12 --timeout 30 --memory-size 256 \
    --environment "Variables={DUB_KEY=$KEY}" >/dev/null
  aws lambda wait function-updated --function-name "$FN"
else
  KEY="${DUB_KEY:-$(head -c 64 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)}"
  aws lambda create-function --function-name "$FN" --runtime python3.12 \
    --architectures x86_64 --handler handler.handler --role "$ROLE_ARN" \
    --timeout 30 --memory-size 256 --zip-file "fileb://$HERE/autodub.zip" \
    --environment "Variables={DUB_KEY=$KEY}" >/dev/null
  aws lambda wait function-active-v2 --function-name "$FN"
fi

echo "[4/6] เปิด Function URL + CORS ..."
CORS="{\"AllowOrigins\":[\"$ORIGIN\"],\"AllowMethods\":[\"POST\"],\"AllowHeaders\":[\"content-type\",\"x-dub-key\"],\"MaxAge\":86400}"
if aws lambda get-function-url-config --function-name "$FN" >/dev/null 2>&1; then
  aws lambda update-function-url-config --function-name "$FN" --auth-type NONE --cors "$CORS" >/dev/null
else
  aws lambda create-function-url-config --function-name "$FN" --auth-type NONE --cors "$CORS" >/dev/null
fi

echo "[5/6] อนุญาตให้เรียกผ่าน URL ..."
aws lambda add-permission --function-name "$FN" --statement-id UrlInvokeUrl \
  --action lambda:InvokeFunctionUrl --principal '*' --function-url-auth-type NONE >/dev/null 2>&1 || true
aws lambda add-permission --function-name "$FN" --statement-id UrlInvokeFunction \
  --action lambda:InvokeFunction --principal '*' --invoked-via-function-url >/dev/null 2>&1 || true
URL="$(aws lambda get-function-url-config --function-name "$FN" --query FunctionUrl --output text)"
sleep 5

echo "[6/6] ทดสอบสร้างเสียง ..."
RESULT="$(curl -s -X POST "$URL" -H 'content-type: application/json' -H "x-dub-key: $KEY" \
  -d '{"text":"สวัสดีครับ ทดสอบเสียงพากย์","voice":"th-TH-NiwatNeural"}' | python3 -c \
  'import sys,json
try:
    j=json.load(sys.stdin)
    print("OK" if j.get("audio") else j)
except Exception as e:
    print("ผิดพลาด:", e)')"

echo
echo "=============================="
echo "ผลทดสอบ : $RESULT"
echo "URL      : $URL"
echo "รหัสลับ  : $KEY"
echo "=============================="
echo "นำ URL กับรหัสลับไปใส่ในแอป: แท็บ พากย์ทันที → พากย์อัตโนมัติ"
