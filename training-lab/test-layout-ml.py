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

# Additional collection-quality tests: distinct examples matter more than clicks.
prep_spec = importlib.util.spec_from_file_location(
    "layout_prepare", ROOT / "prepare-layout-data.py")
prep = importlib.util.module_from_spec(prep_spec)
prep_spec.loader.exec_module(prep)
human = dict(rows[0], source="human")
second = dict(rows[1], source="human")
try:
    m.reject_duplicate_examples([human, human])
except ValueError as error:
    assert "duplicate" in str(error)
else:
    raise AssertionError("identical approved samples counted twice")
try:
    m.reject_duplicate_examples([human, dict(human, label="keep" if human["label"] == "separate" else "separate")])
except ValueError as error:
    assert "conflict" in str(error)
else:
    raise AssertionError("conflicting ground truth not rejected")

with tempfile.TemporaryDirectory() as tmp:
    directory = Path(tmp)
    a, b, combined = (directory / name for name in ("a.jsonl", "b.jsonl", "combined.jsonl"))
    a.write_text(json.dumps(human) + "\n", encoding="utf8")
    b.write_text(json.dumps(human) + "\n" + json.dumps(second) + "\n", encoding="utf8")
    merged, duplicate_count = prep.combine([a, b])
    assert duplicate_count == 1 and len(merged) == 2
    assert prep.readiness(merged)["ready_for_training"] is False
    command = [sys.executable, str(ROOT / "prepare-layout-data.py"),
               "--input", str(a), str(b), "--out", str(combined)]
    generated = subprocess.run(command, capture_output=True, text=True)
    assert generated.returncode == 0, generated.stderr
    assert len(combined.read_text(encoding="utf8").splitlines()) == 2
    assert json.loads(generated.stdout)["duplicates_removed"] == 1
    b.write_text(json.dumps(dict(human, label="keep" if human["label"] == "separate" else "separate")) + "\n")
    try:
        prep.combine([a, b])
    except ValueError as error:
        assert "ขัดแย้ง" in str(error)
    else:
        raise AssertionError("conflicting labels accepted")
    b.write_text(json.dumps(dict(human, voiceover="private narration")) + "\n")
    try:
        prep.combine([a, b])
    except ValueError:
        pass
    else:
        raise AssertionError("unapproved private fields passed numeric-only gate")

print("PASS: CPU SGD updates real weights, holds out entire stories, rejects unapproved/synthetic/duplicate labels and prepares real feedback safely")
