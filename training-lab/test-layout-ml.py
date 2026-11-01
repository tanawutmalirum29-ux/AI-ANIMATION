#!/usr/bin/env python3
"""Contract and real SGD-weight smoke; demo samples NEVER qualify as human data."""
import importlib.util
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SCRIPT = ROOT / "train-layout.py"
spec = importlib.util.spec_from_file_location("cpu_layout", SCRIPT)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
rows = m.demo_data()
assert len(rows) >= 100
assert len({r["group"] for r in rows}) >= 5
train, test, test_groups = m.split_groups(rows)
assert set(r["group"] for r in train).isdisjoint(test_groups)
model = m.train_sgd(train)
assert len(model["weights"]) == len(m.FEATURES)
assert any(abs(x) > .00001 for x in model["weights"]), "weights must actually update"
def pred(row):
    z = model["bias"] + sum(
        model["weights"][i] * row["features"][k] for i,k in enumerate(m.FEATURES))
    return int(m.sigmoid(z) >= .5)
accuracy = m.metrics(test, pred)
assert accuracy["accuracy"] >= .65, accuracy

with tempfile.TemporaryDirectory() as tmp:
    out=Path(tmp)/"model.json"
    result=subprocess.run([sys.executable,str(SCRIPT),"--mode","demo","--out",str(out)],
                          capture_output=True,text=True)
    assert result.returncode == 0, result.stderr
    candidate=json.loads(out.read_text())
    assert candidate["active"] is False
    assert candidate["status"] == "demo-only"
    assert candidate["training"]["mode"] == "demo"
    approved=Path(tmp)/"approved.jsonl"
    approved.write_text("\n".join(json.dumps(x) for x in rows)+"\n")
    reject=subprocess.run([sys.executable,str(SCRIPT),"--mode","approved",
                           "--data",str(approved),"--out",str(out)],
                          capture_output=True,text=True)
    assert reject.returncode != 0, "synthetic examples must never get production weights"
    assert "synthetic" in (reject.stdout+reject.stderr).lower() or "สังเคราะห์" in (
        reject.stdout+reject.stderr)
    sample=dict(rows[0], source="human")
    m.validate(sample)
    for bad in [dict(sample, voiceover="PRIVATE DATA"),
                dict(sample, approved=False),
                dict(sample, features={"gapX": 0.1})]:
        try: m.validate(bad)
        except (ValueError, TypeError): pass
        else: raise AssertionError("invalid row accepted")
print("PASS: CPU SGD updates real weights, holds out entire stories, rejects unapproved and synthetic production data")
