#!/usr/bin/env python3
"""Safety and CPU training tests for shot framing; never promotes demo weights."""
import importlib.util, json, subprocess, sys, tempfile
from pathlib import Path
root=Path(__file__).resolve().parent
script=root/'train-shot.py'
spec=importlib.util.spec_from_file_location('shot',script)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
rows=m.demo_rows()
assert len(rows)==432
assert len({r['group'] for r in rows})==12
train,test,hold=m.split(rows)
assert len(train)>=50 and len(test)>=20
assert not {x['group'] for x in train}.intersection(x['group'] for x in test)
weights=m.learn(train)
assert len(weights['weights'])==10
assert any(abs(x)>1e-5 for x in weights['weights'])
score=m.score(test,lambda x:m.pred(weights,x))
assert score['accuracy']>=.75,score
with tempfile.TemporaryDirectory() as tmp:
    out=Path(tmp)/'model.json'
    r=subprocess.run([sys.executable,str(script),'--mode','demo','--out',str(out)],
                     capture_output=True,text=True)
    assert r.returncode==0,(r.stdout,r.stderr)
    model=json.loads(out.read_text(encoding='utf8'))
    assert model['status']=='demo-only' and model['active'] is False
    assert model['training']['mode']=='demo'
    assert model['training']['examples']>=50
    bad=Path(tmp)/'bad.jsonl'
    bad.write_text('\n'.join(json.dumps(row) for row in rows)+'\n',encoding='utf8')
    denied=subprocess.run([sys.executable,str(script),'--mode','approved',
      '--data',str(bad),'--out',str(out)],capture_output=True,text=True)
    assert denied.returncode!=0
    assert 'synthetic' in (denied.stdout+denied.stderr).lower()
    human=dict(rows[0],source='human')
    m.validate(human)
    for item in [dict(human,voiceover='PRIVATE SCRIPT'),dict(human,approved=False),
                  dict(human,features={'portrait':1})]:
        try:m.validate(item)
        except (ValueError,TypeError):pass
        else:raise AssertionError('unsafe human feedback was accepted')
    try:m.dedup_or_fail([human,human])
    except ValueError:pass
    else:raise AssertionError('duplicate example accepted')
    human_rows=[dict(x,source='human') for x in rows]
    train,test,groups=m.split(human_rows)
    assert len(train)>=50 and len(test)>=20
    # Strict isolation: same story group in train and holdout is never allowed.
    assert set(x['group'] for x in train).isdisjoint(groups)
print('PASS: real CPU SGD and full story holdout; synthetic and unapproved labels blocked; numeric feedback only')
