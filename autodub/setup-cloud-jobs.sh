#!/usr/bin/env bash
# One-time AWS CloudShell Sydney setup. Re-runnable; no API key re-entry.
set -euo pipefail
export AWS_DEFAULT_REGION=ap-southeast-2
REGION=ap-southeast-2
FN=story-studio-autodub
LAMBDA_ROLE=story-studio-autodub-role
SM_ROLE=story-studio-teacher-step-role
SM_NAME=story-studio-teacher-jobs
TABLE="story-studio-teacher-feedback"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
FN_ARN="arn:aws:lambda:$REGION:$ACCOUNT:function:$FN"
SM_ARN="arn:aws:states:$REGION:$ACCOUNT:stateMachine:$SM_NAME"
SM_EXE="arn:aws:states:$REGION:$ACCOUNT:execution:$SM_NAME:*"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
aws lambda get-function --function-name "$FN" >/dev/null
# Guard against accidentally replacing an existing table name.
CURRENT_TABLE="$(aws lambda get-function-configuration --function-name "$FN" --query 'Environment.Variables.TEACHER_FEEDBACK_TABLE' --output text)"
if [[ "$CURRENT_TABLE" != None && -n "$CURRENT_TABLE" ]];then TABLE="$CURRENT_TABLE";fi
aws dynamodb describe-table --table-name "$TABLE" >/dev/null

python3 - "$TMP/trust.json" "$TMP/state-access.json" "$TMP/lambda-access.json" \
  "$FN_ARN" "$SM_ARN" "$SM_EXE" "$REGION" "$ACCOUNT" "$TABLE" <<'PY'
import json,sys
trust,step,lamb,fn,sm,executions,region,account,table=sys.argv[1:]
def save(path,data):
 with open(path,"w") as f:json.dump(data,f)
save(trust,{"Version":"2012-10-17","Statement":[{
 "Effect":"Allow","Principal":{"Service":"states.amazonaws.com"},
 "Action":"sts:AssumeRole"}]})
save(step,{"Version":"2012-10-17","Statement":[{
 "Effect":"Allow","Action":["lambda:InvokeFunction"],"Resource":fn}]})
save(lamb,{"Version":"2012-10-17","Statement":[
 {"Effect":"Allow","Action":["states:StartExecution"],"Resource":sm},
 {"Effect":"Allow","Action":["states:DescribeExecution","states:StopExecution"],
  "Resource":executions},
 {"Effect":"Allow","Action":["dynamodb:GetItem","dynamodb:PutItem",
  "dynamodb:UpdateItem","dynamodb:Query"],
  "Resource":f"arn:aws:dynamodb:{region}:{account}:table/{table}"}]})
PY
echo "[1/4] Configure restricted Step Functions execution role..."
if aws iam get-role --role-name "$SM_ROLE" >/dev/null 2>&1;then
 aws iam update-assume-role-policy --role-name "$SM_ROLE" \
   --policy-document "file://$TMP/trust.json" >/dev/null
else
 aws iam create-role --role-name "$SM_ROLE" \
   --assume-role-policy-document "file://$TMP/trust.json" >/dev/null
 sleep 8
fi
aws iam put-role-policy --role-name "$SM_ROLE" \
  --policy-name story-studio-invoke-only --policy-document \
  "file://$TMP/state-access.json" >/dev/null
aws iam put-role-policy --role-name "$LAMBDA_ROLE" \
  --policy-name story-studio-teacher-cloud-jobs --policy-document \
  "file://$TMP/lambda-access.json" >/dev/null
ROLE_ARN="arn:aws:iam::$ACCOUNT:role/$SM_ROLE"

python3 - "$TMP/state-machine.json" "$FN_ARN" <<'PY'
import json,sys
file,fn=sys.argv[1:]
data={"Comment":"Durable AI Teacher training (2 scenes per Lambda batch, checkpointed to DynamoDB)",
 "StartAt":"RunBatch","States":{
 "RunBatch":{"Type":"Task","Resource":"arn:aws:states:::lambda:invoke",
  "Parameters":{"FunctionName":fn,
   "Payload":{"cloudJobWorker":True,"jobId.$":"$.jobId",
              "generation.$":"$.generation"}},
  "ResultPath":"$.step",
  "Retry":[{"ErrorEquals":["Lambda.ServiceException","Lambda.AWSLambdaException",
          "Lambda.SdkClientException","States.Timeout"],
           "IntervalSeconds":15,"MaxAttempts":3,"BackoffRate":2}],
  "Next":"HasMore"},
 "HasMore":{"Type":"Choice","Choices":[{"Variable":"$.step.Payload.next",
           "BooleanEquals":True,"Next":"WaitForQuota"}],"Default":"Finish"},
 "WaitForQuota":{"Type":"Wait",
           "SecondsPath":"$.step.Payload.waitSeconds","Next":"RunBatch"},
 "Finish":{"Type":"Succeed"}}}
with open(file,"w") as f:json.dump(data,f)
PY
echo "[2/4] Create or update Step Functions Standard..."
if aws stepfunctions describe-state-machine --state-machine-arn "$SM_ARN" >/dev/null 2>&1;then
 aws stepfunctions update-state-machine --state-machine-arn "$SM_ARN" \
   --definition "file://$TMP/state-machine.json" --role-arn "$ROLE_ARN" >/dev/null
else
 aws stepfunctions create-state-machine --name "$SM_NAME" --type STANDARD \
   --role-arn "$ROLE_ARN" --definition "file://$TMP/state-machine.json" >/dev/null
fi
echo "[3/4] Preserve existing Lambda env and enable cloud jobs..."
aws lambda get-function-configuration --function-name "$FN" \
  --query 'Environment.Variables' --output json > "$TMP/old.json"
python3 - "$TMP/old.json" "$TMP/new.json" "$SM_ARN" "$TABLE" <<'PY'
import json,sys
old,new,sm,table=sys.argv[1:]
env=json.load(open(old)) or {}
if env.get("TEACHER_FEEDBACK_TABLE") and env["TEACHER_FEEDBACK_TABLE"]!=table:
 raise SystemExit("Existing teacher table differs; refusing to overwrite.")
env["TEACHER_FEEDBACK_TABLE"]=table
env["TEACHER_JOB_STATE_MACHINE_ARN"]=sm
with open(new,"w") as f:json.dump({"Variables":env},f)
PY
aws lambda update-function-configuration --function-name "$FN" \
 --timeout 90 --environment "file://$TMP/new.json" >/dev/null
aws lambda wait function-updated --function-name "$FN"
echo "[4/4] Verify setup without displaying any secrets..."
ACTUAL="$(aws lambda get-function-configuration --function-name "$FN" \
 --query 'Environment.Variables.TEACHER_JOB_STATE_MACHINE_ARN' --output text)"
test "$ACTUAL" = "$SM_ARN"
CODE_STATUS="$(aws lambda get-function-configuration --function-name "$FN" \
 --query 'LastUpdateStatus' --output text)"
test "$CODE_STATUS" = Successful
echo "CLOUD JOBS READY: $SM_ARN"
echo "Open https://main.d1wc6w01kiwpnk.amplifyapp.com/ and sign in via GitHub."
echo "NOTE: Step Functions, Lambda, DynamoDB and AI provider may incur charges."
