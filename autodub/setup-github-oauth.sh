#!/usr/bin/env bash
# One-time GitHub OAuth cutover. Run only after updated Lambda was deployed.
set -euo pipefail
umask 077
export AWS_DEFAULT_REGION="ap-southeast-2"
FN="story-studio-autodub"
ROLE="story-studio-autodub-role"
PARAM="/story-studio/github-oauth-client-secret"
CALLBACK="https://main.d1wc6w01kiwpnk.amplifyapp.com/"
[[ -t 0 ]] || { echo "Run in interactive AWS CloudShell";exit 1; }
echo "GitHub OAuth App callback URL: $CALLBACK"
echo "Open https://github.com/settings/developers → OAuth Apps → New OAuth App"
read -r -p "GitHub OAuth Client ID: " CLIENT_ID
[[ "$CLIENT_ID" =~ ^[a-zA-Z0-9]{10,100}$ ]] || { echo "Invalid Client ID";exit 1; }
read -rs -p "GitHub OAuth Client Secret (hidden): " CLIENT_SECRET
echo
export CLIENT_SECRET
SIZE="$(printf %s "$CLIENT_SECRET" | wc -c)"
[[ "$SIZE" -ge 20 && "$SIZE" -le 300 ]] || { echo "Invalid Client Secret";exit 1; }
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"; unset CLIENT_SECRET' EXIT
aws lambda get-function --function-name "$FN" >/dev/null
aws lambda get-function-configuration --function-name "$FN" --query 'Environment.Variables' \
 --output json > "$TMP/old.json"
python3 - "$TMP" "$CLIENT_ID" "$PARAM" <<'PY'
import json,os,sys
directory,client_id,param=sys.argv[1:]
secret=os.environ.get("CLIENT_SECRET")
if not secret:raise SystemExit("Missing secret")
with open(directory+"/secret.json","w") as f:
 json.dump({"Name":param,"Value":secret,"Type":"SecureString","Overwrite":True},f)
env=json.load(open(directory+"/old.json"))
env["GITHUB_OAUTH_CLIENT_ID"]=client_id
env["GITHUB_OAUTH_SECRET_PARAMETER"]=param
with open(directory+"/environment.json","w") as f:
 json.dump({"Variables":env},f)
PY
echo "[1/3] Save OAuth Secret in SSM SecureString..."
aws ssm put-parameter --cli-input-json "file://$TMP/secret.json" >/dev/null
echo "[2/3] Grant Lambda least-privilege read for this Secret only..."
ACC="$(aws sts get-caller-identity --query Account --output text)"
python3 - "$TMP/policy.json" "$ACC" "$PARAM" <<'PY'
import json,sys
path,account,name=sys.argv[1:]
doc={"Version":"2012-10-17","Statement":[{
 "Sid":"ReadOnlyStudioGithubOauthSecret","Effect":"Allow",
 "Action":["ssm:GetParameter"],
 "Resource":"arn:aws:ssm:ap-southeast-2:"+account+":parameter"+name}]}
with open(path,"w") as f:json.dump(doc,f)
PY
aws iam put-role-policy --role-name "$ROLE" --policy-name story-github-oauth-read-secret \
 --policy-document "file://$TMP/policy.json" >/dev/null
echo "[3/3] Enable OAuth without clearing existing AI Mother keys or DB..."
aws lambda update-function-configuration --function-name "$FN" \
 --environment "file://$TMP/environment.json" >/dev/null
aws lambda wait function-updated --function-name "$FN"
echo "GitHub OAuth ready. Old shared password authentication is now disabled."
echo "Website: $CALLBACK"
