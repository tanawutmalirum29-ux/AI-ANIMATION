#!/usr/bin/env python3
"""Combine explicit human-reviewed numeric layout feedback (never uploads anything).

This is a local, opt-in preparation tool. Synthetic/demo or private fields
are rejected. Duplicate approvals are collapsed; contradictory labels fail.
"""
import argparse
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("layout_trainer", ROOT / "train-layout.py")
trainer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(trainer)


def combine(paths):
    rows, seen, duplicates = [], {}, 0
    if not paths:
        raise ValueError("ต้องระบุไฟล์ .jsonl ที่ผู้ใช้ตรวจและอนุมัติแล้ว")
    for filename in paths:
        path = Path(filename)
        if not path.is_file() or path.suffix.lower() != ".jsonl":
            raise ValueError(f"ไม่พบไฟล์ .jsonl: {path}")
        for line_number, line in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), 1):
            if not line.strip():
                continue
            try:
                row = trainer.validate(json.loads(line))
            except (ValueError, TypeError, json.JSONDecodeError) as error:
                raise ValueError(f"{path.name}:{line_number}: {error}") from error
            key = (row["group"], tuple(row["features"][k] for k in trainer.FEATURES))
            if key in seen:
                old_label, old_path = seen[key]
                if old_label != row["label"]:
                    raise ValueError(
                        f"คำตอบขัดแย้งกันระหว่าง {old_path} และ {path.name}:{line_number}; "
                        "ต้องให้มนุษย์ตรวจอีกครั้ง"
                    )
                duplicates += 1
                continue
            seen[key] = (row["label"], f"{path.name}:{line_number}")
            rows.append(row)
    if not rows:
        raise ValueError("ไม่มีตัวอย่างที่ใช้ได้")
    return rows, duplicates


def readiness(rows):
    groups = len({row["group"] for row in rows})
    labels = {name: sum(row["label"] == name for row in rows) for name in trainer.LABELS}
    try:
        trainer.split_groups(rows)
        ready, reason = True, "ผ่านเงื่อนไขขั้นต่ำเชิงโครงสร้าง ยังต้องตรวจที่มาของข้อมูล"
    except ValueError as error:
        ready, reason = False, str(error)
    return {"unique_examples": len(rows), "story_groups": groups,
            "label_counts": labels, "ready_for_training": ready, "reason": reason}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", nargs="+", required=True, help="Approved .jsonl files")
    parser.add_argument("--out", required=True, help="Local combined .jsonl output")
    args = parser.parse_args()
    out = Path(args.out)
    if any(Path(path).resolve() == out.resolve() for path in args.input):
        raise ValueError("ห้ามเขียนทับไฟล์ตัวอย่างต้นฉบับ")
    rows, duplicates = combine(args.input)
    report = readiness(rows)
    out.parent.mkdir(parents=True, exist_ok=True)
    # Write only after validating *all* rows; never partially overwrite on error.
    output = "".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in rows)
    out.write_text(output, encoding="utf-8")
    print(json.dumps({"output": str(out), "duplicates_removed": duplicates,
                      **report}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except ValueError as error:
        raise SystemExit(str(error)) from error
