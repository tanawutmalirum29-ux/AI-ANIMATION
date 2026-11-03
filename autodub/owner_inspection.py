"""Verified-owner inspection tools. Only Lambda calls this module, never members.

Live GitHub public code, recent CI and known AWS resources. No raw secrets,
environment values, identities, CloudWatch messages or write-side AWS calls.
Permissions are limited by the *existing* Lambda IAM role; failures are shown.
"""
import base64
import json
import os
import re
import time

BLOCK_PATH=re.compile(r"(?i)(?:^|/)(?:node_modules|dist|build|coverage|__pycache__|private|secrets?|credentials?|tokens?)(?:/|$)|(?:\\.env|\\.pem|\\.p12|\\.lock)$")
VALID_ENDINGS=(".py",".js",".cjs",".css",".html",".md",".json",".yml",".yaml",".sh")
REDACT=re.compile(r"(?i)secret|password|credential|access.?token|private.?key|api.?key|authorization|bearer|session.?key|client.?id|client.?secret")

def _public_path(path):
    return bool(isinstance(path,str) and 1<=len(path)<=150 and
        not BLOCK_PATH.search(path) and
        not any(part.startswith(".") and part!=".github" for part in path.split("/")) and
        path.endswith(VALID_ENDINGS) and
        (path.startswith(("autodub/","tests/","training-lab/",".github/workflows/",
                          "studio-","scripts/")) or
        path in ("README.md","index.html","site-auth.js",
                 "member-portal.js","amplify.yml")))

def _github(question):
    import teacher_advisor as base
    try:
        tree=base._github_read(base.GITHUB_API+"/git/trees/main?recursive=1",1750000)
        entries={}
        for item in tree.get("tree",[]):
            path,sha=item.get("path"),item.get("sha")
            if (_public_path(path) and item.get("type")=="blob" and
                isinstance(sha,str) and re.fullmatch(r"[a-f0-9]{40}",sha)
                and 0<=int(item.get("size") or 0)<=180000):
                entries[path]=sha
        explicit=re.findall(r"[A-Za-z0-9_./-]+\\.(?:py|js|cjs|css|html|md|json|yml|yaml|sh)",question)
        selected=[p for p in explicit if p in entries][:4]
        lower=question.lower()
        topics=[
            (("github","repo","โค้ด","แก้ไข","ไฟล์"),["autodub/handler.py","studio-ai-workspace.js","README.md"]),
            (("aws","lambda","cloud","deploy","เซิร์ฟเวอร์"),["autodub/handler.py","autodub/cloud_jobs.py",".github/workflows/deploy-aws-studio.yml"]),
            (("ล็อกอิน","member","ผู้ใช้","บัญชี","guest"),["autodub/github_oauth.py","site-auth.js","autodub/member_ai.py"]),
            (("เรียน","ลูก","เกลาบท","เทรน"),["autodub/story_auto_train.py","autodub/thai_editor.py","autodub/teacher.py"]),
        ]
        for terms,paths in topics:
            if any(t in lower for t in terms):
                for p in paths:
                    if p in entries and p not in selected and len(selected)<4:
                        selected.append(p)
        if not selected:
            selected=[p for p in ["README.md","autodub/handler.py","studio-ai-workspace.js"] if p in entries][:3]
        excerpts=[]
        for p in selected[:4]:
            obj=base._github_read(base.GITHUB_API+"/git/blobs/"+entries[p],145000)
            if obj.get("encoding")!="base64":continue
            raw=base64.b64decode(obj.get("content",""))[:14000].decode("utf-8","replace")
            text="\n".join("[sensitive source line withheld]" if REDACT.search(line)
                           else line[:220] for line in raw.splitlines()[:110])[:1750]
            excerpts.append({"path":p,"sha":entries[p],"excerpt":text})
        return {"available":True,"source":"github-public-main-live",
                "treeSha":str(tree.get("sha") or "")[:40],
                "totalSafeFiles":len(entries),
                "truncatedTree":bool(tree.get("truncated")),
                "selectedFiles":selected[:4],"snippets":excerpts,
                "privateReposAccessible":False}
    except Exception:
        return {"available":False,"source":"github-public-main-live",
                "reason":"GitHub public API unavailable or rate-limited",
                "privateReposAccessible":False}

def _actions():
    import teacher_advisor as base
    try:
        data=base._github_read(base.GITHUB_API+"/actions/runs?per_page=4",250000)
        return {"available":True,"source":"github-actions-live",
                "runs":[{"name":str(r.get("name") or "")[:80],
                         "status":str(r.get("status") or "")[:30],
                         "conclusion":str(r.get("conclusion") or "")[:30],
                         "headSha":str(r.get("head_sha") or "")[:40]}
                        for r in data.get("workflow_runs",[])[:4]]}
    except Exception:
        return {"available":False,"source":"github-actions-live",
                "reason":"GitHub Actions read unavailable"}

def _aws(question):
    asked=any(t in question.lower() for t in
        ("aws","lambda","amplify","deploy","cloud","ฐานข้อมูล","dynamodb","คิว","เซิร์ฟเวอร์","ระบบ","สถานะ"))
    if not asked:
        return {"requested":False}
    import boto3
    info={"requested":True,"source":"aws-existing-iam-read-only","checkedAt":int(time.time())}
    try:
        cfg=boto3.client("lambda",region_name="ap-southeast-2").get_function_configuration(
            FunctionName="story-studio-autodub")
        # Explicitly do not include Environment, credentials, role ARNs or URLs.
        info["lambda"]={"available":True,
            "state":cfg.get("State"),"lastUpdateStatus":cfg.get("LastUpdateStatus"),
            "lastModified":cfg.get("LastModified"),"runtime":cfg.get("Runtime")}
    except Exception:
        info["lambda"]={"available":False,"reason":"IAM/region does not permit Lambda inspection"}
    try:
        app=boto3.client("amplify",region_name="ap-southeast-2")
        status=app.get_branch(appId="d1wc6w01kiwpnk",branchName="main")["branch"]
        jobs=app.list_jobs(appId="d1wc6w01kiwpnk",branchName="main",maxResults=3)
        info["amplify"]={"available":True,"autoBuild":status.get("enableAutoBuild"),
           "jobs":[{"id":str(j.get("jobId") or "")[:25],
                    "status":str(j.get("status") or "")[:35],
                    "commitId":str(j.get("commitId") or "")[:40]}
                   for j in jobs.get("jobSummaries",[])[:3]]}
    except Exception:
        info["amplify"]={"available":False,"reason":"IAM/region does not permit Amplify inspection"}
    try:
        name=os.getenv("TEACHER_FEEDBACK_TABLE")
        if not name:
            info["database"]={"available":False,"reason":"Not configured"}
        else:
            data=boto3.client("dynamodb",region_name="ap-southeast-2").describe_table(
                TableName=name)["Table"]
            info["database"]={"available":True,"status":data.get("TableStatus"),
              "approximateItems":data.get("ItemCount"),"approximate":True}
    except Exception:
        info["database"]={"available":False,"reason":"IAM does not permit DynamoDB metadata"}
    return info

def inspect(question):
    if not isinstance(question,str) or len(question)>200:
        raise ValueError("Inspect question must be 1–200 characters")
    return {"checkedAt":int(time.time()),
            "github":_github(question),
            "githubActions":_actions() if any(t in question.lower() for t in
                ("github","deploy","ci","actions","repo","โค้ด","ไฟล์")) else {"requested":False},
            "aws":_aws(question),
            "limitations":"read only; no raw keys/tokens/log messages; no private repositories without separately configured authorization"}
