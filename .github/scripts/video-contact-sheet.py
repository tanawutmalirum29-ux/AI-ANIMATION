#!/usr/bin/env python3
"""Extract small contact sheets from the publicly linked videos in GitHub Issue #1."""
import json, os, re, subprocess, pathlib, urllib.request, urllib.error, math

REPO = "tanawutmalirum29-ux/AI-ANIMATION"
ISSUE = 1
root = pathlib.Path("video-review/issue-1")
root.mkdir(parents=True, exist_ok=True)
headers = {"User-Agent": "AI-ANIMATION-video-review/1.0", "Accept": "application/vnd.github+json"}
token = os.environ.get("GITHUB_TOKEN", "")
if token:
    headers["Authorization"] = f"Bearer {token}"

def get(url, target=None, use_token=False):
    h = dict(headers)
    if not use_token:
        h.pop("Authorization", None)
        h["Accept"] = "*/*"
    req = urllib.request.Request(url, headers=h)
    with urllib.request.urlopen(req, timeout=90) as response:
        if target:
            with open(target, "wb") as out:
                while True:
                    chunk = response.read(2**20)
                    if not chunk:
                        break
                    out.write(chunk)
            return None
        return response.read()

def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout.strip()

issue = json.loads(get(f"https://api.github.com/repos/{REPO}/issues/{ISSUE}", use_token=True))
body = issue.get("body") or ""
links = re.findall(r"https://github\.com/user-attachments/assets/[0-9a-fA-F-]{36}", body)
print(f"Issue has {len(links)} video attachment URLs")
all_meta = []
for index, url in enumerate(links[:8], 1):
    target = pathlib.Path(f"/tmp/review_clip_{index}.mp4")
    try:
        get(url, target)
        size = target.stat().st_size
        if size < 1024:
            raise ValueError("Video download was unexpectedly small")
        probe = json.loads(run("ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", str(target)))
        stream = next(x for x in probe["streams"] if x.get("codec_type") == "video")
        duration = float(probe["format"].get("duration") or stream.get("duration") or 1)
        fps = max(0.08, min(12, 16 / max(duration, 0.1)))
        dest = root / f"clip-{index}-contact-sheet.jpg"
        run("ffmpeg","-y","-hide_banner","-loglevel","error","-i",str(target),
            "-vf",f"fps={fps:.5f},scale=240:-2:flags=bicubic,tile=4x4:padding=4:margin=4",
            "-frames:v","1","-q:v","4",str(dest))
        all_meta.append({"clip":index,"source":url,"duration_seconds":round(duration,2),
            "width":stream.get("width"),"height":stream.get("height"),"codec":stream.get("codec_name"),
            "bytes":size,"sheet":str(dest),"sample_interval_sec":round(1 / fps, 3)})
        print(f"Extracted clip {index}: {duration:.1f}s, {size} bytes, sheet {dest}")
    except Exception as error:
        print(f"FAILED clip {index}: {type(error).__name__}: {error}")
        all_meta.append({"clip":index,"source":url,"error":str(error)})
    finally:
        target.unlink(missing_ok=True)

(root / "metadata.json").write_text(json.dumps(all_meta, indent=2, ensure_ascii=False), encoding="utf-8")
