#!/usr/bin/env bash
# One-time CloudShell setup: GitHub main -> short-lived AWS role via OIDC.
# No AWS access keys, site passwords, API keys or Lambda secrets are sent to GitHub.
set -euo pipefail
export AWS_DEFAULT_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-ap-southeast-2}}"
REGION="$AWS_DEFAULT_REGION"
REPO="tanawutmalirum29-ux/AI-ANIMATION"
ROLE="story-studio-gha-deploy"
FN="${STORY_STUDIO_LAMBDA_NAME:-story-studio-autodub}"
APP="d1wc6w01kiwpnk"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
PROVIDER="arn:aws:iam::${ACCOUNT}:oidc-provider/token.actions.githubusercontent.com"
ARN="arn:aws:iam::${ACCOUNT}:role/${ROLE}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "[1/4] ตรวจ GitHub OIDC identity provider..."
if ! aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$PROVIDER" > "$TMP_DIR/provider.json" 2>/dev/null; then
  aws iam create-open-id-connect-provider \
    --url https://token.actions.githubusercontent.com \
    --client-id-list sts.amazonaws.com >/dev/null
else
  if ! python3 - "$TMP_DIR/provider.json" <<'PY'
import json,sys
assert "sts.amazonaws.com" in json.load(open(sys.argv[1])).get("ClientIDList", [])
PY
  then
    aws iam add-client-id-to-open-id-connect-provider \
      --open-id-connect-provider-arn "$PROVIDER" --client-id sts.amazonaws.com
  fi
fi
echo "[2/4] สร้าง IAM Role ที่อนุญาตเฉพาะ branch main..."
python3 - "$TMP_DIR/trust.json" "$PROVIDER" "$REPO" <<'PY'
import json,sys
path,provider,repo=sys.argv[1:]
policy={"Version":"2012-10-17","Statement":[{
 "Effect":"Allow","Principal":{"Federated":provider},
 "Action":"sts:AssumeRoleWithWebIdentity",
 "Condition":{"StringEquals":{
   "token.actions.githubusercontent.com:aud":"sts.amazonaws.com",
   "token.actions.githubusercontent.com:sub":"repo:"+repo+":ref:refs/heads/main"
 }}}]}
with open(path,"w") as f:json.dump(policy,f)
PY
if aws iam get-role --role-name "$ROLE" >/dev/null 2>&1;then
  aws iam update-assume-role-policy --role-name "$ROLE" \
    --policy-document "file://$TMP_DIR/trust.json" >/dev/null
else
  aws iam create-role --role-name "$ROLE" \
    --assume-role-policy-document "file://$TMP_DIR/trust.json" >/dev/null
fi
echo "[3/4] จำกัด IAM permissions เฉพาะ Lambda และ Amplify ของโปรเจกต์..."
python3 - "$TMP_DIR/access.json" "$REGION" "$ACCOUNT" "$FN" "$APP" <<'PY'
import json,sys
path,region,account,fn,app=sys.argv[1:]
policy={"Version":"2012-10-17","Statement":[
 {"Sid":"UpdateExistingStudioLambdaCodeOnly","Effect":"Allow",
  "Action":["lambda:GetFunction","lambda:GetFunctionConfiguration","lambda:UpdateFunctionCode"],
  "Resource":[f"arn:aws:lambda:{region}:{account}:function:{fn}"]},
 {"Sid":"AmplifyMainBranchRelease","Effect":"Allow",
  "Action":["amplify:GetBranch","amplify:StartJob"],
  "Resource":[f"arn:aws:amplify:{region}:{account}:apps/{app}/branches/main"]}
]}
with open(path,"w") as f:json.dump(policy,f)
PY
aws iam put-role-policy --role-name "$ROLE" \
  --policy-name story-studio-gha-limited-deploy \
  --policy-document "file://$TMP_DIR/access.json" >/dev/null

echo "[4/4] ผูก GitHub Actions variable..."
if command -v gh >/dev/null && gh auth status >/dev/null 2>&1;then
  gh variable set AWS_DEPLOY_ROLE_ARN --repo "$REPO" --body "$ARN"
  echo "GitHub variable บันทึกอัตโนมัติสำเร็จ"
else
  echo "ต้องตั้งตัวแปร GitHub ครั้งเดียว:"
  echo "https://github.com/$REPO/settings/variables/actions"
  echo "Name : AWS_DEPLOY_ROLE_ARN"
  echo "Value: $ARN"
fi
echo "GitHub-to-AWS OIDC role ready: $ARN"
echo "หลังตั้ง variable แล้วรัน Deploy AWS Studio จาก GitHub Actions ได้"
echo "ต่อไปทุก push เข้า main จะอัปเดต Lambda และ Amplify โดยไม่ต้องเปิด CloudShell"
