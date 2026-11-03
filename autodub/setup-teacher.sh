#!/usr/bin/env bash
# Provision the optional Teacher Studio storage on AWS CloudShell.
# Run AFTER autodub/deploy.sh. AWS services can incur charges; monitor budgets.
set -euo pipefail
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-ap-southeast-2}}"
FN="${STORY_STUDIO_LAMBDA_NAME:-story-studio-autodub}"
ROLE="${STORY_STUDIO_ROLE_NAME:-story-studio-autodub-role}"
TABLE="${TEACHER_FEEDBACK_TABLE:-story-studio-teacher-feedback}"
PARAM="${TEACHER_SETTINGS_PARAMETER:-/story-studio/teacher-settings}"
export AWS_DEFAULT_REGION="$REGION"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
aws lambda get-function --function-name "$FN" >/dev/null
if ! aws ssm get-parameter --name "$PARAM" >/dev/null 2>&1;then
 aws ssm put-parameter --name "$PARAM" --type SecureString --value '{}' >/dev/null
 echo "Created SecureString parameter."
else echo "Existing teacher credentials preserved.";fi
if ! aws dynamodb describe-table --table-name "$TABLE" >/dev/null 2>&1;then
 aws dynamodb create-table --table-name "$TABLE" \
  --attribute-definitions AttributeName=pk,AttributeType=S AttributeName=sk,AttributeType=S \
  --key-schema AttributeName=pk,KeyType=HASH AttributeName=sk,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST >/dev/null
 aws dynamodb wait table-exists --table-name "$TABLE"
 echo "Created private feedback table."
else echo "Existing feedback table preserved.";fi
POLICY="$(mktemp)"; ENVFILE="$(mktemp)"
trap 'rm -f "$POLICY" "$ENVFILE"' EXIT
python3 - "$POLICY" "$REGION" "$ACCOUNT" "$PARAM" "$TABLE" <<'PY'
import json,sys
path,region,account,param,table=sys.argv[1:]
resources=[
 f"arn:aws:ssm:{region}:{account}:parameter/{param.lstrip('/')}",
 f"arn:aws:dynamodb:{region}:{account}:table/{table}"
]
data={"Version":"2012-10-17","Statement":[
 {"Effect":"Allow","Action":["ssm:GetParameter","ssm:PutParameter"],"Resource":[resources[0]]},
 {"Effect":"Allow","Action":["dynamodb:GetItem","dynamodb:PutItem","dynamodb:UpdateItem","dynamodb:Query"],"Resource":[resources[1]]}
]}
with open(path,"w") as f: json.dump(data,f)
PY
aws iam put-role-policy --role-name "$ROLE" --policy-name story-studio-teacher-storage \
 --policy-document "file://$POLICY"
aws lambda get-function-configuration --function-name "$FN" \
 --query 'Environment.Variables' --output json > "$ENVFILE"
python3 - "$ENVFILE" "$PARAM" "$TABLE" <<'PY'
import json,sys,os
p,param,table=sys.argv[1:]
data=json.load(open(p)) or {}
data["TEACHER_SETTINGS_PARAMETER"]=param
data["TEACHER_FEEDBACK_TABLE"]=table
# Custom compatible hosts must be explicitly set by the operator.
if os.environ.get("TEACHER_ALLOWED_API_HOSTS"):
 data["TEACHER_ALLOWED_API_HOSTS"]=os.environ["TEACHER_ALLOWED_API_HOSTS"]
with open(p,"w") as f:json.dump({"Variables":data},f)
PY
aws lambda update-function-configuration --function-name "$FN" \
 --environment "file://$ENVFILE" >/dev/null
aws lambda wait function-updated --function-name "$FN"
echo "Teacher Studio storage configured on Lambda: $FN"
echo "SSM SecureString: $PARAM | DynamoDB: $TABLE | Region: $REGION"
echo "This is not a zero-cost guarantee. Set AWS Budget alerts and monitor usage."
