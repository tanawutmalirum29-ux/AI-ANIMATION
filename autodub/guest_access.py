"""Temporary non-GitHub sessions. No daily quotas while owner tests v1.

This provides authenticated identity only, not external model credentials.
Server signs 2-hour HMAC tokens using a purpose-separated SESSION_SECRET key.
Never trusts client-supplied roles, names or IDs. No server-side logging.
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import time

SESSION_SECONDS = 2 * 3600

def _resp(code, obj):
    return {"statusCode": code,
            "headers": {"Content-Type":"application/json","Cache-Control":"no-store"},
            "body": json.dumps(obj,ensure_ascii=False)}

def enabled():
    import github_oauth
    return bool(github_oauth.enabled() and
                len(os.getenv("SESSION_SECRET","")) >= 32)

def _b64(raw):
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")

def _unb64(data):
    return base64.urlsafe_b64decode(data+"="*(-len(data)%4))

def _key():
    return hmac.new(os.environ["SESSION_SECRET"].encode(),
                    b"ai-animation-guest-session-v1",hashlib.sha256).digest()

def start():
    if not enabled():
        return _resp(503,{"error":"บัญชีชั่วคราวยังไม่พร้อมใช้"})
    now=int(time.time())
    payload={"v":3,"role":"guest","sub":secrets.token_hex(16),
             "iat":now,"exp":now+SESSION_SECONDS}
    encoded=_b64(json.dumps(payload,separators=(",",":")).encode())
    signature=_b64(hmac.new(_key(),encoded.encode(),hashlib.sha256).digest())
    return _resp(200,{"token":"guest."+encoded+"."+signature,
                      "expiresAt":payload["exp"],"temporary":True,
                      "user":{"id":"guest-"+payload["sub"],
                              "login":"ผู้เยี่ยมชม","role":"guest"}})

def verify(token):
    if (not enabled() or not isinstance(token,str) or
            not 35 <= len(token) <= 1000 or not token.startswith("guest.")):
        return None
    try:
        prefix,encoded,signature=token.split(".")
        expected=_b64(hmac.new(_key(),encoded.encode(),hashlib.sha256).digest())
        if prefix!="guest" or not hmac.compare_digest(signature,expected):
            return None
        claim=json.loads(_unb64(encoded))
        now=int(time.time())
        ident=claim.get("sub")
        if (claim.get("v") != 3 or claim.get("role")!="guest"
            or not isinstance(ident,str) or len(ident)!=32
            or any(c not in "0123456789abcdef" for c in ident)
            or type(claim.get("iat")) is not int or type(claim.get("exp")) is not int
            or claim["iat"]>now+60 or claim["exp"]<=now
            or claim["exp"]>claim["iat"]+SESSION_SECONDS):
            return None
        return {"sub":"guest-"+ident,"login":"ผู้เยี่ยมชม",
                "role":"guest","exp":claim["exp"]}
    except (ValueError,TypeError,KeyError,UnicodeError):
        return None
