#!/usr/bin/env bash
# AWS CloudShell: bash cloud-export/deploy.sh https://main.d1wc6w01kiwpnk.amplifyapp.com
set -euo pipefail
umask 077
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-ap-southeast-2}}"
export AWS_DEFAULT_REGION="$REGION"
ORIGIN="${1:-https://main.d1wc6w01kiwpnk.amplifyapp.com}"
if [[ ! "$ORIGIN" =~ ^https://[A-Za-z0-9.-]+/?$ ]];then echo "Provide an HTTPS origin" >&2;exit 1;fi
ORIGIN="${ORIGIN%/}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FN="${STORY_STUDIO_LAMBDA_NAME:-story-studio-autodub}"
PROJECT="story-studio-cloud-render"
ROLE="$PROJECT-role"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="story-cloud-export-$ACCOUNT-$REGION"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
if ! aws lambda get-function --function-name "$FN" >/dev/null 2>&1;then
 echo "First deploy the login backend: bash autodub/deploy.sh $ORIGIN" >&2;exit 1
fi
echo "[1/6] Private S3 bucket with two-day expiry"
if ! aws s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1;then
 if [[ "$REGION" == "us-east-1" ]];then aws s3api create-bucket --bucket "$BUCKET" >/dev/null
 else aws s3api create-bucket --bucket "$BUCKET" --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null;fi
fi
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration 'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true'
printf '{"CORSRules":[{"AllowedOrigins":["%s"],"AllowedMethods":["PUT"],"AllowedHeaders":["content-type"],"MaxAgeSeconds":3600}]}' "$ORIGIN" >"$TMP/cors.json"
aws s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration "file://$TMP/cors.json"
cat >"$TMP/expire.json" <<'JSON'
{"Rules":[{"ID":"RemoveRenderJobs","Filter":{"Prefix":"jobs/"},"Status":"Enabled","Expiration":{"Days":2},"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":1}}]}
JSON
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration "file://$TMP/expire.json"
echo "[2/6] IAM role and CodeBuild permissions"
cat >"$TMP/trust.json" <<'JSON'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"codebuild.amazonaws.com"},"Action":"sts:AssumeRole"}]}
JSON
if ! aws iam get-role --role-name "$ROLE" >/dev/null 2>&1;then
 aws iam create-role --role-name "$ROLE" --assume-role-policy-document "file://$TMP/trust.json" >/dev/null
fi
# Repair stale trust policies on reruns, and make CodeBuild the trusted service.
aws iam update-assume-role-policy --role-name "$ROLE" --policy-document "file://$TMP/trust.json"
ROLE_ARN="$(aws iam get-role --role-name "$ROLE" --query Role.Arn --output text)"
python3 - "$TMP/worker-policy.json" "$BUCKET" "$REGION" "$ACCOUNT" <<'PY'
import json,sys
p,b,r,a=sys.argv[1:]
json.dump({"Version":"2012-10-17","Statement":[
{"Effect":"Allow","Action":["s3:GetObject","s3:PutObject"],"Resource":["arn:aws:s3:::"+b+"/jobs/*"]},
{"Effect":"Allow","Action":["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents"],"Resource":["arn:aws:logs:"+r+":"+a+":log-group:/aws/codebuild/*"]}]},open(p,"w"))
PY
aws iam put-role-policy --role-name "$ROLE" --policy-name StoryCloudRenderWorker --policy-document "file://$TMP/worker-policy.json"
echo "[3/6] Chromium and FFmpeg render service"
cat >"$TMP/buildspec.yml" <<'YAML'
version: 0.2
phases:
  install:
    commands:
      - npm install --prefix /tmp/story-cloud-tools --no-audit --no-fund playwright@1.56.1
      - /tmp/story-cloud-tools/node_modules/.bin/playwright install chromium --with-deps
      - if ! command -v ffmpeg >/dev/null || ! command -v zip >/dev/null || ! command -v unzip >/dev/null; then apt-get update -qq && apt-get install -y ffmpeg zip unzip; fi
  build:
    commands:
      - git clone --depth 1 --branch main https://github.com/tanawutmalirum29-ux/AI-ANIMATION.git /tmp/story-site
      - cd /tmp/story-site
      - NODE_PATH=/tmp/story-cloud-tools/node_modules node cloud-export/worker.cjs
YAML
python3 - "$TMP/project.json" "$TMP/buildspec.yml" "$PROJECT" "$ROLE_ARN" <<'PY'
import json,sys
p,spec,name,role=sys.argv[1:]
json.dump({"name":name,"source":{"type":"NO_SOURCE","buildspec":open(spec).read()},
"artifacts":{"type":"NO_ARTIFACTS"},"environment":{"type":"LINUX_CONTAINER","image":"aws/codebuild/standard:7.0",
"computeType":"BUILD_GENERAL1_MEDIUM","imagePullCredentialsType":"CODEBUILD","privilegedMode":False},
"serviceRole":role,"timeoutInMinutes":120,"queuedTimeoutInMinutes":60,"concurrentBuildLimit":1},open(p,"w"))
PY
if aws codebuild batch-get-projects --names "$PROJECT" --query 'projects[0].name' --output text 2>/dev/null|grep -qx "$PROJECT";then
 CODEBUILD_OPERATION="update-project"
else
 CODEBUILD_OPERATION="create-project"
fi
# Newly created or updated IAM roles can take time to propagate to CodeBuild.
# Retry only the known transient AssumeRole error; fail fast for all other errors.
for attempt in {1..12};do
 if aws codebuild "$CODEBUILD_OPERATION" --cli-input-json "file://$TMP/project.json" >"$TMP/codebuild.out" 2>"$TMP/codebuild.err";then
  break
 fi
 if ! grep -q 'CodeBuild is not authorized to perform: sts:AssumeRole' "$TMP/codebuild.err";then
  cat "$TMP/codebuild.err" >&2
  exit 1
 fi
 if (( attempt == 12 ));then
  cat "$TMP/codebuild.err" >&2
  echo "CodeBuild still cannot assume $ROLE_ARN. Verify IAM trust and that STS is enabled in $REGION." >&2
  exit 1
 fi
 echo "Waiting for IAM role propagation ($attempt/12); retrying CodeBuild in 5 seconds..."
 sleep 5
done
echo "[4/6] Grant authenticated Lambda access to the render queue"
python3 - "$TMP/api-policy.json" "$BUCKET" "$REGION" "$ACCOUNT" "$PROJECT" <<'PY'
import json,sys
p,b,r,a,project=sys.argv[1:]
json.dump({"Version":"2012-10-17","Statement":[
{"Effect":"Allow","Action":["s3:GetObject","s3:PutObject"],"Resource":["arn:aws:s3:::"+b+"/jobs/*"]},
{"Effect":"Allow","Action":["codebuild:StartBuild","codebuild:BatchGetBuilds","codebuild:StopBuild"],"Resource":["arn:aws:codebuild:"+r+":"+a+":project/"+project]}
]},open(p,"w"))
PY
LROLE_ARN="$(aws lambda get-function-configuration --function-name "$FN" --query Role --output text)"
LROLE="${LROLE_ARN##*/}"
aws iam put-role-policy --role-name "$LROLE" --policy-name StoryCloudExportAPI --policy-document "file://$TMP/api-policy.json"
aws lambda get-function-configuration --function-name "$FN" --query Environment.Variables --output json >"$TMP/old.json"
python3 - "$TMP/old.json" "$TMP/new.json" "$BUCKET" "$PROJECT" <<'PY'
import json,sys
src,out,b,p=sys.argv[1:]
d=json.load(open(src)) or {}
d.update(CLOUD_EXPORT_BUCKET=b,CLOUD_EXPORT_PROJECT=p)
json.dump({"Variables":d},open(out,"w"))
PY
aws lambda update-function-configuration --function-name "$FN" --environment "file://$TMP/new.json" >/dev/null
aws lambda wait function-updated --function-name "$FN"
echo "[5/6] Deploy updated API into existing password-protected Lambda"
bash "$ROOT/autodub/deploy.sh" "$ORIGIN"
echo "[6/6] Enable Cloud Export in Amplify"
export STORY_STUDIO_CLOUD_ORIGIN="$ORIGIN"
python3 <<'PY'
import os,re
m=re.fullmatch(r"https://([A-Za-z0-9-]+)\.([A-Za-z0-9]+)\.amplifyapp\.com",os.environ["STORY_STUDIO_CLOUD_ORIGIN"])
if not m:
 print("For custom domains, set STORY_STUDIO_CLOUD_EXPORT=1 in Amplify and rebuild")
else:
 import boto3
 branch,app_id=m.groups()
 api=boto3.client("amplify")
 env=api.get_app(appId=app_id)["app"].get("environmentVariables") or {}
 env["STORY_STUDIO_CLOUD_EXPORT"]="1"
 api.update_app(appId=app_id,environmentVariables=env)
 try:
  print("Amplify build:",api.start_job(appId=app_id,branchName=branch,jobType="RELEASE")["jobSummary"]["jobId"])
 except Exception as exc:
  print("Trigger an Amplify build manually:",type(exc).__name__)
PY
echo "Cloud rendering configured. Temporary files expire in 2 days."
echo "AWS CodeBuild, S3, Lambda and data transfer can incur fees. Configure an AWS Budget alarm."
