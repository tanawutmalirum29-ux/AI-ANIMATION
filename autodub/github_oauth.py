"""GitHub OAuth PKCE sign-in, identity-derived admin role and signed sessions.

Activated ONLY when both GitHub OAuth client ID and SSM secret path are set.
While unconfigured the existing password login stays enabled so owner isn't locked out.
All GitHub tokens remain server-side and are discarded after fetching /user.
"""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
import urllib.request
import urllib.parse

ADMIN_GITHUB_USER_ID = 225819900  # Verified repository owner ID, not a username string
SESSION_SECONDS = 4 * 3600
REDIRECT_URI = "https://main.d1wc6w01kiwpnk.amplifyapp.com/"
ALLOWED_ROLES = ("admin", "member")
PKCE_RE = re.compile(r"^[A-Za-z0-9._~-]{43,128}$")
CODE_RE = re.compile(r"^[A-Za-z0-9_-]{10,512}$")

def enabled():
    return bool(os.getenv("GITHUB_OAUTH_CLIENT_ID") and
                os.getenv("GITHUB_OAUTH_SECRET_PARAMETER") and
                os.getenv("SESSION_SECRET"))

def _resp(code, value):
    return {"statusCode": code, "headers": {"Content-Type":"application/json",
            "Cache-Control":"no-store"},
            "body":json.dumps(value,ensure_ascii=False)}

def config():
    # Public metadata only; no secret or user records.
    import guest_access
    return _resp(200, {"mode":"github" if enabled() else "legacy-password",
                       "clientId":os.getenv("GITHUB_OAUTH_CLIENT_ID","") if enabled() else "",
                       "redirectUri":REDIRECT_URI if enabled() else "",
                       "guestEnabled": guest_access.enabled()})

def _b64(data):
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")

def _unb64(value):
    return base64.urlsafe_b64decode(value+"="*(-len(value)%4))

def issue_session(identity):
    if not os.getenv("SESSION_SECRET"):
        raise ValueError("Server signing key not configured")
    uid=identity.get("id")
    if type(uid) is not int or uid<=0:
        raise ValueError("Invalid verified GitHub user ID")
    role="admin" if uid==ADMIN_GITHUB_USER_ID else "member"
    now=int(time.time())
    safe_name=str(identity.get("login") or "")[:80]
    # Role is derived exclusively from GitHub's verified immutable numeric ID.
    claim={"v":2,"sub":uid,"login":safe_name,"role":role,"iat":now,
           "exp":now+SESSION_SECONDS,"nonce":secrets.token_hex(12)}
    payload=_b64(json.dumps(claim,separators=(",",":")).encode())
    signature=_b64(hmac.new(os.environ["SESSION_SECRET"].encode(),
                            payload.encode(),hashlib.sha256).digest())
    return payload+"."+signature,claim

def verify(token):
    if not enabled() or not isinstance(token,str) or len(token)>3000:
        return None
    try:
        payload,signature=token.split(".")
        expected=_b64(hmac.new(os.environ["SESSION_SECRET"].encode(),
                                payload.encode(),hashlib.sha256).digest())
        if not hmac.compare_digest(expected,signature):
            return None
        claims=json.loads(_unb64(payload))
        now=int(time.time())
        if (claims.get("v")!=2 or type(claims.get("sub")) is not int or
            claims["sub"]<=0 or claims.get("role") not in ALLOWED_ROLES or
            type(claims.get("iat")) is not int or type(claims.get("exp")) is not int or
            claims["iat"]>now+60 or claims["exp"]<=now or
            claims["exp"]>claims["iat"]+SESSION_SECONDS):
            return None
        if claims["role"]!=("admin" if claims["sub"]==ADMIN_GITHUB_USER_ID else "member"):
            return None
        return {k:claims[k] for k in ("sub","login","role","exp")}
    except (ValueError,TypeError,KeyError,UnicodeError):
        return None

def _github_json(url,headers,body=None):
    req=urllib.request.Request(url,data=body,headers=headers,
                               method="POST" if body is not None else "GET")
    with urllib.request.urlopen(req,timeout=12) as res:
        if res.status!=200:
            raise ValueError("GitHub OAuth rejected the request")
        return json.loads(res.read(16384).decode("utf-8"))

def exchange(body):
    if not enabled():
        return _resp(503,{"error":"ยังไม่ได้ตั้งค่า GitHub OAuth ใน AWS"})
    code=body.get("code")
    verifier=body.get("codeVerifier")
    if not isinstance(code,str) or not CODE_RE.fullmatch(code):
        return _resp(400,{"error":"GitHub authorization code ไม่ถูกต้อง"})
    if not isinstance(verifier,str) or not PKCE_RE.fullmatch(verifier):
        return _resp(400,{"error":"GitHub PKCE verifier ไม่ถูกต้อง"})
    try:
        import boto3
        secret=boto3.client("ssm").get_parameter(
           Name=os.environ["GITHUB_OAUTH_SECRET_PARAMETER"],WithDecryption=True
        )["Parameter"]["Value"]
        if not secret:
            raise ValueError("Missing GitHub OAuth secret")
        payload=urllib.parse.urlencode({
           "client_id":os.environ["GITHUB_OAUTH_CLIENT_ID"],
           "client_secret":secret,"code":code,
           "redirect_uri":REDIRECT_URI,
           "code_verifier":verifier
        }).encode()
        token_data=_github_json("https://github.com/login/oauth/access_token",
                  {"Accept":"application/json",
                   "Content-Type":"application/x-www-form-urlencoded",
                   "User-Agent":"AI-ANIMATION-Story-Studio"},payload)
        access=token_data.get("access_token")
        if (not isinstance(access,str) or len(access)<10 or
            token_data.get("error")):
            return _resp(401,{"error":"GitHub ไม่อนุญาตให้เข้าสู่ระบบ กรุณาลองใหม่"})
        identity=_github_json("https://api.github.com/user",{
            "Accept":"application/vnd.github+json",
            "Authorization":"Bearer "+access,
            "User-Agent":"AI-ANIMATION-Story-Studio"})
        # Never log/store/return the upstream user access token.
        signed,claim=issue_session(identity)
        return _resp(200,{"token":signed,"expiresAt":claim["exp"],
                          "user":{"id":claim["sub"],"login":claim["login"],
                                  "role":claim["role"]}})
    except Exception:
        # No HTTP bodies, secret values or OAuth access tokens in error details.
        return _resp(502,{"error":"GitHub OAuth ติดต่อบริการไม่สำเร็จหรือคีย์ไม่ถูกต้อง"})
