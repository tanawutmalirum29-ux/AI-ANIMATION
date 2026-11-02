#!/usr/bin/env python3
"""Combine user-approved numeric shot labels; fail on contradictory reviews."""
import argparse, importlib.util, json
from pathlib import Path
ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('shot_trainer',ROOT/'train-shot.py')
trainer=importlib.util.module_from_spec(spec);spec.loader.exec_module(trainer)
def combine(paths):
    if not paths:raise ValueError('Please supply reviewed shot-framing .jsonl files')
    rows=[];seen={};duplicates=0
    for raw in paths:
        path=Path(raw)
        if not path.is_file() or path.suffix.lower()!='.jsonl':
            raise ValueError('Missing human-review JSONL: '+str(path))
        for n,line in enumerate(path.read_text(encoding='utf-8-sig').splitlines(),1):
            if not line.strip():continue
            try:row=trainer.validate(json.loads(line))
            except (ValueError,TypeError,json.JSONDecodeError) as exc:
                raise ValueError(f'{path.name}:{n}: {exc}') from exc
            key=(row['group'],tuple(row['features'][k] for k in trainer.FEATURES))
            if key in seen:
                if seen[key]!=row['label']:
                    raise ValueError(f'Contradictory human labels for same shot {path.name}:{n}')
                duplicates+=1;continue
            seen[key]=row['label'];rows.append(row)
    return rows,duplicates
def main():
    p=argparse.ArgumentParser()
    p.add_argument('--input',nargs='+',required=True)
    p.add_argument('--out',required=True)
    a=p.parse_args()
    out=Path(a.out)
    if any(Path(p).resolve()==out.resolve() for p in a.input):
        raise ValueError('Cannot overwrite original human feedback')
    rows,dup=combine(a.input)
    if not rows:raise ValueError('No approved human feedback')
    try:
        train,hold,groups=trainer.split(rows)
        ready=True;message=f'{len(train)} train, {len(hold)} holdout'
    except ValueError as exc:
        ready=False;message=str(exc)
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(''.join(json.dumps(r,ensure_ascii=False,sort_keys=True)+'\n' for r in rows),encoding='utf8')
    print(json.dumps({'unique':len(rows),'duplicate_removed':dup,
       'stories':len({x['group'] for x in rows}),
       'keep':sum(r['label']=='keep' for r in rows),
       'reframe':sum(r['label']=='reframe' for r in rows),
       'ready_for_cpu_training':ready,'reason':message},ensure_ascii=False))
if __name__=='__main__':
    try:main()
    except ValueError as exc:raise SystemExit(str(exc))
