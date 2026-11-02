#!/usr/bin/env python3
"""CPU-only supervised SGD for shot-framing. Demo weights are NEVER deployable.
 Only human-reviewed JSONL examples may become inactive candidate models.
 No text, media, external APIs, or phone CPU/GPU used.
"""
import argparse, hashlib, json, math, random
from pathlib import Path

FEATURES = ('portrait','world','zoom','panDistance','targetOffset','gateOverlap',
            'actorCount','moving','action','duration')
LABELS = {'keep': 0, 'reframe': 1}
SEED = 260211

def validate(row, demo=False):
    if not isinstance(row,dict) or set(row)!= {'schema','task','source','approved','group','label','features'}:
        raise ValueError('Only seven numeric-feedback fields are allowed, not scripts or video')
    if row['schema']!=1 or row['task']!='shot-framing' or row['approved'] is not True:
        raise ValueError('Training example is not human-approved schema 1')
    if row['source'] not in (('human','synthetic') if demo else ('human',)):
        raise ValueError('Synthetic data cannot be used as approved training data')
    if not isinstance(row['group'],str) or not 5<=len(row['group'])<=80 or not all(
        c.isascii() and (c.isalnum() or c in '-_') for c in row['group']):
        raise ValueError('Story group must be anonymized ASCII identifier')
    if row['label'] not in LABELS or not isinstance(row['features'],dict) or set(row['features'])!=set(FEATURES):
        raise ValueError('Invalid label or features')
    if any(type(row['features'][k]) not in (float,int) or not math.isfinite(row['features'][k]) or
           not 0<=row['features'][k]<=1 for k in FEATURES):
        raise ValueError('All features must be finite numbers [0,1]')
    return row

def demo_rows():
    rng=random.Random(SEED)
    rows=[]
    for group in range(12):
        for _ in range(36):
            v={k:round(rng.random(),4) for k in FEATURES}
            v['portrait']=rng.choice([0,1])
            v['moving']=rng.choice([0,1])
            v['action']=rng.choice([0,1])
            v['actorCount']=rng.choice([.0,.125,.25,.375])
            # Simulated storyboard preferences: high target offset, gate bleed in
            # market shot, and unusually fast pan are considered BAD. Synthetic
            # examples demonstrate learning mechanics, NOT good human judgment.
            bad=(v['targetOffset']>.52 or v['gateOverlap']>.44 or
                 v['panDistance']>.74 and v['action']==1)
            rows.append(validate(dict(schema=1,task='shot-framing',source='synthetic',approved=True,
             group='demo_story_%02d'%group,label='reframe' if bad else 'keep',features=v),demo=True))
    return rows

def load(path):
    if not path.is_file():raise ValueError('Missing human-approved shot-framing JSONL dataset')
    rows=[]
    for i,line in enumerate(path.read_text(encoding='utf8').splitlines(),1):
        if not line.strip():continue
        try:rows.append(validate(json.loads(line)))
        except (ValueError,TypeError,json.JSONDecodeError) as exc:raise ValueError(f'row {i}: {exc}') from exc
    return rows

def dedup_or_fail(rows):
    seen={}
    for i,r in enumerate(rows,1):
        key=(r['group'],tuple(r['features'][k] for k in FEATURES))
        if key in seen:raise ValueError('Duplicate or conflicting shot labels at rows %d, %d'%(seen[key],i))
        seen[key]=i

def split(rows):
    groups=sorted({x['group'] for x in rows},key=lambda s:hashlib.sha256(s.encode()).hexdigest())
    if len(groups)<5 or len(rows)<100:raise ValueError('Need >=100 human-reviewed examples from >=5 DISTINCT stories')
    held=set(groups[:max(2,round(len(groups)*.25))])
    train=[r for r in rows if r['group'] not in held]
    hold=[r for r in rows if r['group'] in held]
    if len(train)<50 or len(hold)<20 or any({r['label'] for r in part}!=set(LABELS) for part in (train,hold)):
        raise ValueError('Train >=50 and holdout >=20, BOTH labels in each, split by STORY')
    return train,hold,sorted(held)

def sigmoid(z):return 1/(1+math.exp(-max(-35,min(35,z))))
def learn(rows):
    rng=random.Random(SEED)
    w=[0.0]*len(FEATURES);bias=0.
    data=[([r['features'][k] for k in FEATURES],LABELS[r['label']]) for r in rows]
    for epoch in range(180):
        rng.shuffle(data)
        lr=.18/(1+.022*epoch)
        for v,y in data:
            error=sigmoid(bias+sum(a*b for a,b in zip(w,v)))-y
            for i,x in enumerate(v):w[i]-=lr*(error*x+.0015*w[i])
            bias-=lr*error
    return {'weights':[round(x,8) for x in w],'bias':round(bias,8)}
def pred(weights,r):
    return int(sigmoid(weights['bias']+sum(w*r['features'][k] for w,k in zip(weights['weights'],FEATURES)))>=.5)
def baseline(r):
    f=r['features']
    return int(f['targetOffset']>.5 or f['gateOverlap']>.45)
def score(rows,fn):
    y=[LABELS[r['label']] for r in rows];p=[fn(r) for r in rows]
    f1=[]
    for label in (0,1):
        tp=sum(a==b==label for a,b in zip(y,p))
        fp=sum(a!=label and b==label for a,b in zip(y,p))
        fn=sum(a==label and b!=label for a,b in zip(y,p))
        f1.append(2*tp/(2*tp+fp+fn) if 2*tp+fp+fn else 0.)
    return {'accuracy':round(sum(a==b for a,b in zip(y,p))/len(y),4),
            'macroF1':round(sum(f1)/2,4)}
def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--mode',choices=('demo','approved'),required=True)
    ap.add_argument('--data',default='training-lab/datasets/approved/shot-framing.jsonl')
    ap.add_argument('--out',required=True)
    args=ap.parse_args()
    rows=demo_rows() if args.mode=='demo' else load(Path(args.data))
    dedup_or_fail(rows)
    train,hold,groups=split(rows)
    learned=learn(train);ml=score(hold,lambda r:pred(learned,r));base=score(hold,baseline)
    qualifies=args.mode=='approved' and ml['macroF1']>=.7 and \
      ml['macroF1']>=base['macroF1']+.02 and ml['accuracy']>=base['accuracy']
    model={'schema':1,'task':'shot-framing','features':list(FEATURES),**learned,
           'status':'candidate-review' if qualifies else 'demo-only' if args.mode=='demo' else 'rejected',
           'active':False,'training':{'mode':args.mode,'examples':len(train),
           'holdoutExamples':len(hold),'holdoutGroups':groups,
           'model':ml,'baseline':base}}
    target=Path(args.out);target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(json.dumps(model,indent=2,ensure_ascii=False)+'\n',encoding='utf8')
    print(json.dumps({'status':model['status'],'train':len(train),'holdout':len(hold),
     'model':ml,'baseline':base},ensure_ascii=False))
if __name__=='__main__':
    try:main()
    except ValueError as exc:raise SystemExit(str(exc)) from exc
