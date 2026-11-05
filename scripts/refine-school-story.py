"""Rebuild the authored school example; never reads or edits browser projects."""
import copy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILE = ROOT / 'examples/taweetha-zombie-siege.json'
p = json.loads(FILE.read_text())
scenes = p['episodes'][0]['scenes']
barricade = copy.deepcopy(next(x for s in scenes for x in s['customAssets'] if x['eventKind'] == 'school-barricade'))

def actor(char, x, y=89, pose='stand', facing='right', view='threeQuarter', **extra):
    return {**dict(char=char, x=x, y=y, pose=pose, facing=facing, view=view,
                   face='surprised', scale=.82, smartActing=False, allowCrop=True, poseTransitions=True,
                   ground=dict(mode='surface',lane=.6)), **extra}

def key(t, x, y=89, pose='run', **extra):
    return dict(t=t, x=x, y=y, pose=pose, easing='linear', **extra)

def travel(char, points, pose='run', facing='right', **extra):
    a = actor(char, points[0][1], points[0][2], pose, facing, 'side', **extra)
    a['motionKeys'] = [key(t, x, y, pose) for t, x, y in points]
    a['gait'] = 'distance'
    a['stride'] = 7 if pose == 'run' else 6
    return a

def held(s, char, kind, hand='right', **extra):
    index = len(s['props'])
    s['props'].append(dict(kind=kind, x=50, y=80, scale=.75, front=False, **extra))
    s['interactionInitialHold'].append(dict(propIndex=index, actor=char, hand=hand))

durations = [5, 4, 5, 4, 5, 5, 5, 6, 5, 5, 6, 7]
lines = [
    'กริ่งเช้าดังขึ้น แต่คนหน้าประตูกลับเดินเซเข้ามา',
    'พี่ครับ ได้ยินผมไหม? เดี๋ยว... ถอยก่อน!',
    'เขาพุ่งเข้ามา! นนท์วิ่งหนีเข้าตึกเรียนทันที',
    'นนท์ ทางนี้! ครูรออยู่ในห้อง รีบมา!',
    'เข้ามาเร็ว! ช่วยกันดันโต๊ะขวางประตู!',
    'โต๊ะขวางไว้ได้ แต่เสียงทุบกลับดังมาจากหน้าต่าง',
    'กระจกจะแตกแล้ว! ไปบันไดหลัง เร็ว!',
    'ไฟดับทั้งชั้น ครูยกไฟฉายนำทุกคนขึ้นบันได',
    'ล็อกอยู่! ครูครับ มีกุญแจดาดฟ้าไหม?',
    'มี! ถอยนิดหนึ่ง... เปิดแล้ว ขึ้นไปเลย!',
    'ถึงดาดฟ้าแล้ว มายด์โทรขอความช่วยเหลือ นนท์รีบโบกมือส่งสัญญาณ',
    'อย่าเพิ่งวางสาย... ประตูข้างหลัง กำลังเปิดเอง!',
]
captions = [
    ['กริ่งเช้าดังขึ้น', 'คนหน้าประตูเดินเซ'], ['ได้ยินผมไหม?', 'เดี๋ยว... ถอยก่อน!'],
    ['เขาพุ่งเข้ามา!', 'นนท์วิ่งหนีเข้าตึก'], ['นนท์ ทางนี้!', 'ครูรออยู่ในห้อง'],
    ['เข้ามาเร็ว!', 'ดันโต๊ะขวางประตู!'], ['โต๊ะขวางไว้ได้', 'แต่เสียงมาจากหน้าต่าง'],
    ['กระจกจะแตกแล้ว!', 'ไปบันไดหลัง เร็ว!'], ['ไฟดับทั้งชั้น', 'ตามแสงไฟฉายขึ้นไป'],
    ['ประตูล็อกอยู่!', 'ครูมีกุญแจไหม?'], ['ถอยนิดหนึ่ง...', 'เปิดแล้ว ขึ้นไปเลย!'],
    ['โทรขอความช่วยเหลือ', 'ส่งสัญญาณจากดาดฟ้า'], ['อย่าเพิ่งวางสาย...', 'ประตูข้างหลังกำลังเปิด!'],
]
locations = ['front-gate', 'front-gate', 'courtyard', 'hallway', 'classroom', 'classroom', 'hallway', 'stairwell', 'roof-landing', 'roof-landing', 'rooftop', 'rooftop']
for i, s in enumerate(scenes):
    d = durations[i]
    s.update(duration=d, location=locations[i], actors=[], props=[], customAssets=[],
             productionEvents=[], productionPlacements={}, productionMotionOverrides={},
             interactions=[], interactionInitialHold=[], atmosphere='none',
             choreography=dict(mode='fit-scene', duration=d, revision=4),
             voiceover=lines[i], subtitle=[],
             transition=dict(type='cut', duration=0),
             camera=dict(type='static', world=1, **{'from':1.025, 'to':1.025}),
             lighting=dict(exposure=1.02, glow=.03, vignette=.13, focusX=50, focusY=40, flicker=0),
             light={'color':'#263b4d', 'opacity':.08},
             notes='School story revision 4. Soles bind to the floor or exact stair tread. Door height, handle and floor share world geometry. Authored y is a fallback; ground.mode resolves the final foot position. Motion fits the final scene duration.')
    s.pop('schoolDoorKeys', None)
    s.pop('worldEffects', None)
    speaker=s['voiceDirection']['voiceProfileId']
    s['subtitleCues']=[dict(id=f'cue-{i+1}-{j+1}',text=text,start=round(.15+j*d/2,2),end=round((j+1)*d/2-.12,2),speaker=speaker,emotion='suspense') for j,text in enumerate(captions[i])]
    s['voiceDirection'].update(pace='urgent but clear' if speaker!='narrator' else 'measured, concise',notes='Generate this revised line. Visual choreography follows the final scene duration; do not reuse old speech as the revised narration.')

s=scenes[0]
s['actors']=[travel('zombie',[(0,84,83),(5,76,83)],'walk','left',scale=.56)]
s['camera'].update(type='dolly',to=1.08)

s=scenes[1]
s['actors']=[actor('nont',32,89,'point',intentionalHold=True),travel('zombie',[(0,76,87),(4,57,87)],'walk','left')]
s['actors'][0]['motionKeys']=[key(0,32,89,'point'),key(2.5,32,89,'surprised'),key(4,25,89,'surprised')]

s=scenes[2]
s['actors']=[travel('nont',[(0,63,91),(5,5,91)],facing='left',allowCrop=True),travel('zombie',[(0,99,87),(5,40,87)],facing='left',allowCrop=True)]
s['camera'].update(type='follow',**{'from':1.06,'to':1.06})

s=scenes[3]
s['actors']=[travel('mind',[(0,50,90),(4,2,90)],facing='left',allowCrop=True),travel('nont',[(0,94,91),(4,43,91)],facing='left',allowCrop=True)]

s=scenes[4]
s['actors']=[actor('teacher',10,89,'stand',view='side',intentionalHold=True,ground=dict(mode='surface',lane=.2)),
             travel('mind',[(0,94,90),(1.7,28,90),(5,28,90)],facing='left',intentionalHold=True),
             travel('nont',[(0,108,91),(.45,108,91),(1.8,66,91),(3,80.6,91),(3.15,80.6,91),(4.85,46,91),(5,46,91)],facing='left',intentionalHold=True,handTarget=dict(door=True,start=1.8,end=3.05),ground=dict(mode='surface',lane=.8))]
s['actors'][1]['motionKeys'][1]['pose']='stand';s['actors'][1]['motionKeys'][2]['pose']='stand'
for k in s['actors'][2]['motionKeys']:
    if 1.8 <= k['t'] <= 3: k.update(pose='openDoor',facing='right')
    elif 3.15 <= k['t'] < 4.85: k.update(pose='walk',facing='left')
    elif k['t'] >= 4.85: k.update(pose='stand',facing='left')
s['schoolDoorKeys']=[dict(t=0,open=.85),dict(t=1.8,open=.85),dict(t=3,open=0),dict(t=5,open=0)]

s=scenes[5]
barricade['asset']['shapes'][0].update(y=8,h=17)
barricade['asset']['shapes'][1].update(y=25,h=69)
barricade['asset']['shapes'][2].update(y=25,h=69)
barricade['asset']['shapes'][3].update(y=0,h=8)
barricade.update(x=66,y=90,scale=.32,front=False,motionKeys=[dict(t=0,x=66,y=90),dict(t=4.3,x=82,y=90),dict(t=5,x=82,y=90)])
s['customAssets']=[barricade];s['productionEvents']=['school-barricade']
s['productionPlacements']={'school-barricade':dict(x=66,y=90,scale=.32,front=False)}
s['actors']=[travel('nont',[(0,46,90),(4.3,62,90),(5,62,90)],pose='walk',intentionalHold=True,handTarget=dict(asset='school-barricade',anchor=dict(x=9,y=9)),ground=dict(mode='surface',lane=.8)),
             actor('mind',28,87,'surprised',intentionalHold=True),
             actor('teacher',10,87,'stand',intentionalHold=True,ground=dict(mode='surface',lane=.2))]
s['actors'][0]['motionKeys'][-2]['pose']='carry';s['actors'][0]['motionKeys'][-1]['pose']='carry'
s['schoolDoorKeys']=[dict(t=0,open=0),dict(t=5,open=0)]

s=scenes[6]
s['actors']=[travel('mind',[(0,37,90),(1.4,37,90),(5,-8,90)],facing='left',allowCrop=True),
             travel('nont',[(0,64,91),(1.7,64,91),(5,16,91)],facing='left',allowCrop=True),
             travel('teacher',[(0,91,87),(1.9,91,87),(5,44,87)],facing='left',allowCrop=True)]
for a in s['actors']:a['motionKeys'][0]['pose']='surprised'
s['worldEffects']=dict(windowCrackAt=1.2)

s=scenes[7]
s['actors']=[travel('teacher',[(0,40,77),(6,92,60)],scale=.73,override=dict(shoulderL=-65,elbowL=-38)),
             travel('nont',[(0,18,84),(6,70,67)],scale=.73),
             travel('mind',[(0,1,90),(6,53,73)],scale=.73,allowCrop=True)]
held(s,'teacher','flashlight','left',light=dict(intensity=.65,range=56,cone=24,keys=[dict(t=0,angle=-10),dict(t=2,angle=8),dict(t=4,angle=-5),dict(t=6,angle=-12)]))
s['lighting'].update(exposure=.9,vignette=.2)
s['light']=dict(color='#101c2f',opacity=.2)

s=scenes[8]
s['actors']=[actor('nont',80,89,'openDoor',view='side',intentionalHold=True,handTarget=dict(door=True),ground=dict(mode='surface',lane=.8)),
             travel('teacher',[(0,36,90),(2.3,52,90),(5,52,90)],pose='walk',intentionalHold=True,override=dict(shoulderL=-65,elbowL=-38),ground=dict(mode='surface',lane=.1)),
             actor('mind',26,89,'surprised',intentionalHold=True)]
s['actors'][1]['motionKeys'][1]['pose']='stand';s['actors'][1]['motionKeys'][2]['pose']='stand'
held(s,'teacher','flashlight','left',light=dict(intensity=.55,range=40,cone=20))
s['schoolDoorKeys']=[dict(t=0,open=0),dict(t=5,open=0)]

s=scenes[9]
s['actors']=[travel('teacher',[(0,52,89),(.8,52,89),(1.8,80,89),(3.1,80,89),(3.7,71,89),(5,71,89)],pose='walk',intentionalHold=True,handTarget=dict(door=True,start=1.8,end=3.1),override=dict(shoulderL=-65,elbowL=-38),ground=dict(mode='surface',lane=.1)),
             travel('nont',[(0,80,91),(.9,39,91),(3.3,39,91),(5,111,91)],allowCrop=True,clipX=95,ground=dict(mode='surface',lane=.8)),
             travel('mind',[(0,26,87),(3.5,26,87),(5,93,87)],allowCrop=True,clipX=95)]
s['actors'][0]['motionKeys'][0]['pose']='stand'
s['actors'][0]['motionKeys'][2]['pose']='openDoor';s['actors'][0]['motionKeys'][3]['pose']='walk';s['actors'][0]['motionKeys'][4]['pose']='stand';s['actors'][0]['motionKeys'][5]['pose']='stand'
s['actors'][1]['motionKeys'][0].update(pose='walk',facing='left');s['actors'][1]['motionKeys'][1].update(pose='stand',facing='right')
s['actors'][2]['motionKeys'][0]['pose']='stand'
held(s,'teacher','key',appearAt=1.8)
held(s,'teacher','flashlight','left',light=dict(intensity=.45,range=40,cone=20))
s['schoolDoorKeys']=[dict(t=0,open=0),dict(t=2.5,open=0),dict(t=3.4,open=.9),dict(t=5,open=.9)]

s=scenes[10]
s['actors']=[actor('nont',24,90,'wave',intentionalHold=True),actor('mind',50,89,'phone',view='side',intentionalHold=True),actor('teacher',76,87,'point',view='side',intentionalHold=True,override=dict(shoulderR=-112,elbowR=-12))]
held(s,'mind','phone')
held(s,'teacher','flashlight',light=dict(intensity=.7,range=50,cone=17,keys=[dict(t=i*.6,intensity=.7 if i%2==0 else .08,angle=-10) for i in range(11)]))
s['schoolDoorKeys']=[dict(t=0,open=.8),dict(t=1,open=0),dict(t=6,open=0)]

s=scenes[11]
s['actors']=[travel('mind',[(0,50,90),(1.3,50,90),(3.2,36,90),(7,36,90)],pose='walk',intentionalHold=True),
             travel('teacher',[(0,76,88),(1.5,76,88),(3.2,60,88),(7,60,88)],pose='walk',intentionalHold=True),
             travel('nont',[(0,24,91),(1.5,24,91),(3.2,12,91),(7,12,91)],pose='walk',intentionalHold=True),
             travel('zombie',[(0,90,86),(4.2,90,86),(7,78,86)],pose='walk',facing='left',appearAt=4.2,scale=.76)]
for a,pose in zip(s['actors'][:3],['phone','point','surprised']):
    a['motionKeys'][0]['pose']=pose
    a['motionKeys'][-2]['pose']='surprised' if a['char']=='mind' else pose
    a['motionKeys'][-1]['pose']=a['motionKeys'][-2]['pose']
held(s,'mind','phone')
held(s,'teacher','flashlight',light=dict(intensity=.55,range=42,cone=18,keys=[dict(t=0,angle=-30),dict(t=3.4,angle=0),dict(t=7,angle=0)]))
s['schoolDoorKeys']=[dict(t=0,open=0),dict(t=3.2,open=0),dict(t=4.2,open=.72),dict(t=7,open=.72)]
s['camera'].update(type='dolly',to=1.07)

for s in scenes:
    for a in s['actors']:
        if a.get('handTarget'): a['handTarget']['referenceWidth']=50.625
    s['characters'] = list(dict.fromkeys(a['char'] for a in s['actors']))
    s['productionSoundCues'] = []  # Old descriptive cues had no rendered audio.

for loc in p['locations']:
    loc['set']['light']='none'
    # Correct obsolete anchors outside the frame and away from the drawn doors.
    if loc['id']=='classroom':loc['set']['anchors']=dict(door=dict(x=84,y=87),window=dict(x=65,y=87),desk=dict(x=66,y=90))
    if loc['id']=='rooftop':loc['set']['anchors']=dict(roofDoor=dict(x=84,y=87),signal=dict(x=24,y=90))
p['locations']=[loc for loc in p['locations'] if loc['id']!='roof-landing']
p['locations'].append(dict(id='roof-landing',name='ชานพักก่อนประตูดาดฟ้า',promptBlock='Interior upper stair landing. The locked roof door is ahead; characters have not reached the roof yet.',set=dict(worldArt='school-landing',light='none',bg=['#344d5d','#182a37'],floor='#657776',floorY=83,props=[],anchors=dict(roofDoor=dict(x=86,y=88)))))
p['project']['title']='ซอมบี้บุกโรงเรียนทวีธาภิเศก — นาทีระทึก'
p['project']['storyRevision']=4
p['project']['fps']=30
p['project']['styleSuffix']='Original fictional Thai school thriller. Revision 4: physical door proportions, sole contacts on floors and stair treads, continuous blocking across adjacent shots, wrist-attached props, no gore.'
for rule in p.get('rules',[]):
    if rule['id']=='run-timing': rule['text']='Distance-based gait continues to the scene cut, unless intentionalHold is set. Shared authored timing fits the final scene duration.'
    if rule['id']=='door-motion': rule['text']='Doors use schoolDoorKeys in the shared choreography clock. Classroom closes in scene 5; landing door is locked in scene 9, unlocked in scene 10; roof door opens at the finale.'
for c in p['characters']:
    c['voiceProfileId']=c['id'] if c['id']!='zombie' else 'narrator'
    c['voice']='Use the assigned voice profile for authored dialogue; no automatic lip sync.'
FILE.write_text(json.dumps(p,ensure_ascii=False,indent=2)+'\n')
print('Updated',len(scenes),'scenes,',sum(durations),'seconds')
