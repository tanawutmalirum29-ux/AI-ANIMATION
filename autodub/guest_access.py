"""Short-lived guest access without GitHub; never creates an admin identity.

Requires existing DynamoDB table for server-side IP issuance rate limiting.
Guest tokens are HMAC signed with the same stable SESSION_SECRET as GitHub
sessions but carry an incompatible v=3 guest claim and a distinct prefix.
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import time

SESSION_SECONDS = 2 * 3600
STARTS_PER_IP_PER_DAY = 3

def _resp(code, body):
    return {"statusCode": code,
            "headers": {"Content-Type":"application/json","Cache-Control":"no-store"},
            "body": json.dumps(body,ensure_ascii=False)}

def enabled():
    import github_oauth
    return bool(github_oauth.enabled() and os.getenv("TEACHER_FEEDBACK_TABLE") and
                len(os.getenv("SESSION_SECRET","")) >= 32)

def _b64(value):
    return base64.urlsafe_b64encode(value).decode().rstrip("=")

def _unb64(value):
    return base64.urlsafe_b64decode(value+"="*(-len(value)%4))

def _key():
    return hmac.new(os.environ["SESSION_SECRET"].encode(),
                    b"ai-animation-guest-v1", hashlib.sha256).digest()

def verify(token):
    if not enabled() or not isinstance(token,str) or len(token)>1200 or not token.startswith("guest."):
        return None
    try:
        _,payload,signature=token.split(".")
        expected=_b64(hmac.new(_key(),payload.encode(),hashlib.sha256).digest())
        if not hmac.compare_digest(expected,signature):
            return None
        claim=json.loads(_unb64(payload))
        now=int(time.time())
        if (claim.get("v")!=3 or claim.get("role")!="guest"
            or not isinstance(claim.get("sub"),str)
            or len(claim["sub"])!=32 or not all(c in "0123456789abcdef" for c in claim["sub"])
            or type(claim.get("iat")) is not int or type(claim.get("exp")) is not int
            or claim["iat"]>now+60 or claim["exp"]<=now
            or claim["exp"]>claim["iat"]+SESSION_SECONDS):
            return None
        return {"sub":"guest-"+claim["sub"],"login":"ผู้เยี่ยมชม","role":"guest",
                "exp":claim["exp"]}
    except (ValueError,TypeError,KeyError,UnicodeError):
        return None

def start(event):
    if not enabled():
        return _resp(503,{"error":"บัญชีชั่วคราวยังไม่พร้อมใช้งาน"})
    # Only AWS Function URL requestContext is trusted; never X-Forwarded-For.
    ip=(event.get("requestContext") or {}).get("http",{}).get("sourceIp")
    if not isinstance(ip,str) or not 3<=len(ip)<=80:
        return _resp(503,{"error":"ตรวจที่มาของการเข้าสู่ระบบไม่ได้"})
    now=int(time.time())
    day=time.strftime("%Y%m%d",time.gmtime(now))
    ip_hash=hmac.new(_key(),ip.encode(),hashlib.sha256).hexdigest()[:32]
    try:
        import boto3
        table=boto3.resource("dynamodb").Table(os.environ["TEACHER_FEEDBACK_TABLE"])
        table.update_item(
            Key={"pk":"guest-session-issuance#"+day,"sk":"ip#"+ip_hash},
            UpdateExpression="ADD #count :one SET createdAt=if_not_exists(createdAt,:now)",
            ConditionExpression="attribute_not_exists(#count) OR #count < :limit",
            ExpressionAttributeNames={"#count":"count"},
            ExpressionAttributeValues={":one":1,":limit":STARTS_PER_IP_PER_DAY,
                                       ":now":now})
    except Exception as exc:
        code=getattr(exc,"response",{}).get("Error",{}).get("Code")
        if code=="ConditionalCheckFailedException":
            return _resp(429,{"error":"สิทธิ์เข้าใช้ชั่วคราวจากเครือข่ายนี้ครบแล้ววันนี้"})
        return _resp(503,{"error":"ระบบจำกัดการเข้าใช้ชั่วคราวไม่พร้อม"})
    claim={"v":3,"sub":secrets.token_hex(16),"role":"guest",
           "iat":now,"exp":now+SESSION_SECONDS}
    payload=_b64(json.dumps(claim,separators=(",",":")).encode())
    sig=_b64(hmac.new(_key(),payload.encode(),hashlib.sha256).digest())
    return _resp(200,{"token":"guest."+payload+"."+sig,
                      "expiresAt":claim["exp"],
                      "user":{"id":"guest-"+claim["sub"],"login":"ผู้เยี่ยมชม",
                              "role":"guest"},"temporary":True})
