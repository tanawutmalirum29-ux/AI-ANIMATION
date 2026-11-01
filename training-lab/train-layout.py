#!/usr/bin/env python3
"""Train a tiny binary layout advisor using CPU-only incremental SGD, stdlib only.

This NEVER publishes a production model. Human-approved examples are required
for --mode approved; synthetic --mode demo cannot pass a production approval.
"""
import argparse
import hashlib
import json
import math
import random
from pathlib import Path

FEATURES = ("gapX", "gapY", "portrait", "count", "moving",
            "interaction", "locked", "edge")
LABELS = {"keep": 0, "separate": 1}
SEED = 19017


def validate(row, *, allow_demo=False):
    keys = {"schema", "task", "approved", "source", "group", "label", "features"}
    if not isinstance(row, dict) or set(row) != keys:
        raise ValueError("ต้องมีเฉพาะ 7 ฟิลด์ที่อนุญาต; ห้ามแนบเสียง/บท/ชื่อเรื่อง")
    if row["schema"] != 1 or row["task"] != "layout-spacing" or row["approved"] is not True:
        raise ValueError("ต้องเป็นตัวอย่างที่ผู้ใช้อนุมัติแล้ว")
    if row["source"] not in (("human", "synthetic") if allow_demo else ("human",)):
        raise ValueError("ห้ามใช้ข้อมูลสังเคราะห์หรือข้อมูลที่ AI อนุมัติเองเป็นชุดฝึกจริง")
    group = row["group"]
    if not isinstance(group, str) or not 5 <= len(group) <= 80 or not all(
        c.isascii() and (c.isalnum() or c in "_-") for c in group
    ):
        raise ValueError("group ต้องเป็นรหัสกลุ่มไม่ระบุตัวตน")
    if row["label"] not in LABELS:
        raise ValueError("label ต้องเป็น keep หรือ separate")
    vector = row["features"]
    if not isinstance(vector, dict) or set(vector) != set(FEATURES):
        raise ValueError("features ต้องตรงกับ schema ของเว็บไซต์")
    if any(type(vector[k]) not in (int, float) or not math.isfinite(vector[k]) or
           not 0 <= vector[k] <= 1 for k in FEATURES):
        raise ValueError("features ทุกค่าเป็นตัวเลขในช่วง 0..1")
    return row


def demo_data():
    rng = random.Random(SEED)
    rows = []
    for group_no in range(12):
        for _ in range(24):
            gapx = rng.uniform(.01, .33)
            gapy = rng.uniform(0, .27)
            portrait = int(rng.random() > .45)
            interaction = int(rng.random() < .13)
            locked = int(rng.random() < .1)
            moving = int(rng.random() < .3)
            x = {"gapX": gapx, "gapY": gapy, "portrait": portrait,
                 "count": rng.choice([.25, .375, .5]), "moving": moving,
                 "interaction": interaction, "locked": locked,
                 "edge": rng.uniform(.08, .8)}
            needs = (gapx < (.23 if portrait else .14) and gapy < .17
                     and not interaction and not locked)
            row = {"schema": 1, "task": "layout-spacing", "approved": True,
                   "source": "synthetic", "group": f"demo_story_{group_no:02d}",
                   "label": "separate" if needs else "keep",
                   "features": {k: round(v, 4) for k, v in x.items()}}
            rows.append(validate(row, allow_demo=True))
    return rows


def read_rows(path):
    if not path.is_file():
        raise ValueError(f"ยังไม่มีไฟล์ข้อมูลมนุษย์อนุมัติ: {path}")
    rows = []
    for number, line in enumerate(path.read_text(encoding="utf8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            rows.append(validate(json.loads(line)))
        except (ValueError, TypeError, json.JSONDecodeError) as exc:
            raise ValueError(f"แถว {number}: {exc}") from exc
    return rows



def reject_duplicate_examples(rows):
    """Do not let repeated clicks inflate approved training/holdout counts.

    Within one story, the same eight-feature input must not have multiple
    approvals or contradictory ground-truth labels. Use prepare-layout-data.py
    to combine and deduplicate human-reviewed files first.
    """
    seen = {}
    for line_number, row in enumerate(rows, 1):
        key = (row["group"], tuple(row["features"][feature] for feature in FEATURES))
        previous = seen.get(key)
        if previous is None:
            seen[key] = (row["label"], line_number)
        elif previous[0] != row["label"]:
            raise ValueError(
                f"approved label conflict at row {line_number} and {previous[1]} "
                "(same story and layout features)"
            )
        else:
            raise ValueError(
                f"duplicate approved example at row {line_number} and {previous[1]}; "
                "run prepare-layout-data.py to collapse repeated exports"
            )
    return rows


def split_groups(rows):
    group_names = sorted({r["group"] for r in rows},
                         key=lambda g: hashlib.sha256(g.encode()).hexdigest())
    if len(group_names) < 5:
        raise ValueError("ต้องมีอย่างน้อย 5 เรื่องที่ต่างกันเพื่อทำ group holdout")
    count = max(2, round(len(group_names) * .25))
    test_groups = set(group_names[:count])
    train = [r for r in rows if r["group"] not in test_groups]
    test = [r for r in rows if r["group"] in test_groups]
    if len(rows) < 60 or len(train) < 35 or len(test) < 15:
        raise ValueError("ต้องมี >=60 ตัวอย่าง; train >=35 และ holdout >=15")
    if {r["label"] for r in train} != set(LABELS) or {
            r["label"] for r in test} != set(LABELS):
        raise ValueError("ทั้ง train/holdout ต้องมีทั้ง keep และ separate")
    return train, test, sorted(test_groups)


def sigmoid(z):
    return 1 / (1 + math.exp(-max(-35, min(35, z))))


def train_sgd(rows, epochs=180):
    rng = random.Random(SEED)
    weights = [0.0] * len(FEATURES)
    bias = 0.0
    eta, regularizer = .17, .0015
    pairs = [([float(row["features"][k]) for k in FEATURES],
              LABELS[row["label"]]) for row in rows]
    for epoch in range(epochs):
        rng.shuffle(pairs)
        for x, y in pairs:
            probability = sigmoid(bias + sum(a*b for a, b in zip(weights, x)))
            error = probability-y
            rate = eta / (1+.025*epoch)
            for index, value in enumerate(x):
                weights[index] -= rate*(error*value+regularizer*weights[index])
            bias -= rate*error
    return {"weights": [round(x, 8) for x in weights], "bias": round(bias, 8)}


def baseline(row):
    x = row["features"]
    return 1 if x["gapX"] < (.12 if x["portrait"] else .09) and (
        x["gapY"] < .08 and not x["interaction"] and not x["locked"]) else 0


def metrics(rows, classifier):
    y = [LABELS[r["label"]] for r in rows]
    predictions = [classifier(r) for r in rows]
    accuracy = sum(a == b for a, b in zip(y, predictions))/len(y)
    f1 = []
    for label in (0, 1):
        tp = sum(a == label and b == label for a, b in zip(y, predictions))
        fp = sum(a != label and b == label for a, b in zip(y, predictions))
        fn = sum(a == label and b != label for a, b in zip(y, predictions))
        f1.append(2*tp/(2*tp+fp+fn) if 2*tp+fp+fn else 0)
    return {"accuracy": round(accuracy, 4), "macroF1": round(sum(f1)/2, 4)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("demo", "approved"), default="demo")
    parser.add_argument("--data", default="training-lab/datasets/approved/layout-spacing.jsonl")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    rows = demo_data() if args.mode == "demo" else read_rows(Path(args.data))
    if args.mode == "approved":
        reject_duplicate_examples(rows)
    train, test, groups = split_groups(rows)
    learned = train_sgd(train)
    def learned_classifier(row):
        score = learned["bias"] + sum(
            w*row["features"][key] for w, key in zip(learned["weights"], FEATURES))
        return int(sigmoid(score) >= .5)
    ml = metrics(test, learned_classifier)
    base = metrics(test, baseline)
    qualifies = (args.mode == "approved" and ml["macroF1"] >= .7
                 and ml["macroF1"] >= base["macroF1"]+.02
                 and ml["accuracy"] >= base["accuracy"])
    artifact = {"schema": 1, "task": "layout-spacing",
                "features": list(FEATURES), **learned,
                "status": ("candidate-review" if qualifies else
                           "demo-only" if args.mode == "demo" else "rejected"),
                "training": {"examples": len(train), "holdoutExamples": len(test),
                             "holdoutGroups": groups, "mode": args.mode,
                             "baseline": base, "model": ml},
                "active": False}
    target = Path(args.out)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(artifact, ensure_ascii=False, indent=2)+"\n", encoding="utf8")
    print(json.dumps({"file": str(target), "status": artifact["status"],
                      "train": len(train), "holdout": len(test),
                      "baseline": base, "model": ml}, ensure_ascii=False))
    # A candidate is never deployed automatically, even if it wins.
    return artifact


if __name__ == "__main__":
    try:
        main()
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc
