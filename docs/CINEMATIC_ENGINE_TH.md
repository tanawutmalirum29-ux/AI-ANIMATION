# Cinematic Blueprint รุ่น 1 — ขอบเขตที่ใช้งานได้จริง

รุ่นนี้เป็นแกนกำกับภาพ **2.5D SVG แบบกำหนดพิกัดและเวลา** ต่อกับตัวละคร เสียง Timeline และ Export เดิม ไม่ใช่โมเดลสร้างวิดีโอใหม่ และยังไม่ครบทุกความสามารถในโจทย์ Advanced Cinematic Engine

## เริ่มใช้งาน

1. หน้าหลัก → เปิดพื้นที่ตัดต่อ → **กำกับภาพ → กำกับ Cinematic** (เข้าได้จากผู้ช่วย AI และ AI Workflow เดิมเช่นกัน)
2. เลือกฉาก A–E แล้วกด **สร้างแผนตัวอย่าง** หรือโหลด Blueprint JSON ที่กำกับเอง/ได้จาก AI ครู
3. ตรวจรายการช็อตและคำเตือน แก้ JSON ในส่วนพับเก็บได้ คำสั่งที่รองรับในช่องบทต้องเป็นคำสั่งเวลาอย่างชัดเจน เช่น:

   ```text
   0-3: กล้อง x=1400 y=900 zoom=1.2
   3-6: ตัวละคร x=1600 y=1150 ท่า=walk
   ```

   ข้อความอื่นจะถูกเก็บเป็น `unknowns` ไม่สุ่มแปลเป็นฉาก/ท่า ตัวอย่างที่เลือก **ไม่ได้พิสูจน์ว่าเข้าใจบทอิสระ** ปุ่มส่งออกโจทย์ให้ AI ครูรวมบท schema และข้อจำกัดไว้ในไฟล์สำหรับใช้กับกระบวนการ AI เดิม ไม่มีการส่ง API หรือซื้อบริการใหม่อัตโนมัติ
4. ตรวจแผนและยืนยัน แล้วเลือก **เพิ่มเป็นฉากใหม่** ซึ่งต่อท้ายตอนและ Undo ได้ หรือ **ปรับฉากปัจจุบัน** สำหรับเปลี่ยนเฉพาะ Blueprint โดยรักษาเสียง/ซับเดิม ฉากที่มีเสียงแล้วจะไม่เปลี่ยนความยาวจากปุ่มนี้
5. เพิ่มบทพากย์และใช้ **พากย์ฉากปัจจุบัน** ผ่านบริการเสียงที่ตั้งค่าไว้เดิม หรือเพิ่มไฟล์เสียงเอง แล้วส่งออกเป็นวิดีโอ เลือก 30 FPS ได้แล้ว

หน้าเริ่มต้น/การแบ่งสิทธิ์เดิมยังใช้เหมือนเดิม ไม่มีการยกระดับสมาชิกเป็นแอดมิน เครื่องมือ local สำหรับกำกับภาพไม่ต้องใช้ API key การตั้งค่า/ฝึก AI ยังเป็นหน้าที่แอดมิน

## โครงสร้างและจุดเชื่อม

- `studio-cinematic-core.js`: schema validation, world-to-screen projection, camera keyframes, deterministic scene evaluation, two-bone hand IK, layered SVG และ preflight QA
- `studio-cinematic-planner.js`: ฉากตั้งต้น A–E, parser สำหรับคำสั่งเวลาแบบระบุค่า, ชุดข้อมูลส่งให้ AI ครู
- `studio-cinematic-studio.js` / `.css`: UI, การเพิ่ม/แก้เฉพาะฉากด้วย undo, adapter เรียก `d6Keys` และ `d6Wardrobe` เดิม จึงคงชุด/สี/ทรงผมจาก character ID
- `studio-video-reference.js`: วิเคราะห์วิดีโอ local ผ่าน HTMLVideo/Canvas, ยกเลิกงานได้, preview และบันทึกข้อสังเกตรายช็อต
- `index.html`: hook เฉพาะ `scene.cinematicPlan`, รับ IK เฉพาะ actor ที่กำกับ, validation, ตัวเลือก 30 FPS, ป้องกันตัดเสียงที่ยาวกว่า Blueprint
- `studio-production-planner.js` / `studio-timing-auditor.js`: ไม่ให้กฎเดิมเขียนทับ geometry หรือย่อ/ยืดเฉพาะ duration ของ cinematic scene จน keyframes ผิดเวลา
- `studio-ai-workspace.js`: เปิดผู้กำกับจาก workflow เดิมและรวมผล preflight ของ Blueprint ใน quality-inspector
- `cloud-export/render-qa.cjs`: ตรวจวิดีโอที่ decode จริงด้วย FFmpeg/FFprobe
- `cloud-export/worker.cjs`: Chromium เส้นทางเดิม → H.264/AAC 30 FPS → QA → S3; รายงานอยู่ข้างวิดีโอหรือภายใน ZIP แยกตอน
- `autodub/handler.py` / `cloud-export-client.js`: ลิงก์รายงาน QA ใช้ owner authorization เดียวกับวิดีโอ อายุ 15 นาที งานเก่าที่ไม่มีรายงานยังดาวน์โหลดได้

พรีวิวและ export ใช้ SVG จาก evaluator เดียวกัน ไม่มี runtime clock หรือการสุ่มในแอนิเมชัน การเลื่อน playhead ย้อนหลังให้ภาพเดิมได้ ข้อมูล Blueprint อยู่ใน JSON โปรเจกต์และผ่านการบันทึกเดิม ไม่มีการลบโมเดล/ข้อมูลฝึก/ประวัติเดิม

## พิกัดและ Timeline

`scene.cinematicPlan.schema = "story-cinematic/1"` ใช้ world units ไม่ใช่พิกเซลหน้าจอ มาตรฐานกล้องสูง 900 world units ความกว้าง viewport ตาม aspect; `world.width/height` กำหนดพื้นที่แพน `groundY` คือระดับพื้น

- `camera.keys`: `t,x,y,zoom,roll,easing` เริ่ม t=0 เรียงเวลาไม่ซ้ำ รองรับ path/follow และ shake ที่จำกัดระยะ กล้องถูกจำกัดให้อยู่ใน world แม้เอียงภาพ
- `actors`: ID ของ instance, `char` อ้างตัวละครเดิม, `height,z,stride,keys` ซึ่งเก็บ x/y/pose/view/facing
- `objects`: kind ที่รองรับ, x/y/z, width/height, rotation, anchor และ motion keys เสริม
- depth `z`: ค่ามากอยู่ไกล ค่าใกล้ศูนย์เป็นพื้นที่ตัวละคร ค่าติดลบเล็กน้อยเป็น foreground; projection สร้าง parallax แล้วเรียงการบังภาพจากไกลมาใกล้
- `interactions`: pickup/place/open มี actor/object ID และเวลาชัดเจน การหยิบใช้มือ rig และ IK, การวางมีจุดปล่อยที่ตรวจได้
- `lighting.keys`: intensity/fog/angle ใช้เวลาเดียวกับกล้องและนักแสดง
- `shots`: ชื่อและช่วงเวลาสำหรับตรวจแผน; เป็นช่วงกำกับในฉาก ไม่ใช่การตัดวิดีโอจากไฟล์อ้างอิงโดยอัตโนมัติ
- เสียงและ subtitle ใช้ `scene.audioClips`, `subtitle`, `subtitleCues` เดิม
- `cinematicReview`: คำตัดสินพร้อมสำเนาแผน ระบุ `kind=review-example`, `trained=false` ใช้เป็นข้อมูลตรวจ/ตัวอย่างได้ แต่ **ไม่ได้ฝึกน้ำหนักโมเดล**

## วิดีโออ้างอิงที่แนบมา

ทั้งสามไฟล์เป็น 576×1024, 30 FPS มี AAC audio; ความยาวประมาณ 73.80 / 63.25 / 93.85 วินาที ตรวจวัดจากไฟล์จริงด้วย FFprobe

`examples/cinematic/references/reference-{1,2,3}.json` มี hash ไฟล์ เวลา คะแนนความต่างภาพ และ **candidate shots** 13 / 8 / 10 ช่วง (ตัวอย่างทุก 0.5s, threshold .12) ผลทดสอบ browser กับไฟล์เดียวกันได้ 13 / 9 / 9 ช่วง (การ seek/resize ของ decoder ต่างจาก FFmpeg ได้) ไม่ใช่ ground-truth shot boundaries; แฟลช การซูม และภาพเปลี่ยนเร็วทำให้แจ้งเกิน/ขาดได้

ข้อสังเกตจากเฟรมตัวอย่าง: คลิปแรกสลับฉากอาคาร/พื้นที่นอกอาคาร/ริมน้ำและภาพใกล้วัตถุ คลิปสองมีภาพสถานที่ริมน้ำ บันได กลุ่มตัวละคร และภาพใกล้โทรศัพท์ คลิปสามมีฉากกลางคืน หน้าร้าน บ้าน และภาพใกล้ตัวละคร สิ่งเหล่านี้เป็นการดูเฟรมโดยผู้ช่วย ไม่ใช่ผล semantic detection ของระบบ ไม่ได้ยืนยันทุกการกระทำหรือพิกัด 3D

ไฟล์วิดีโอต้นฉบับและตัวละครต้นฉบับไม่รวมใน repository; ฉาก A–E เป็นตัวอย่างใหม่ ระบบ browser ไม่อัปโหลดวิดีโอ ผู้ใช้สามารถดูคลิป เลือกช็อต และบันทึกข้อสังเกตซึ่งระบุ `source=user-review` ได้

## ขอบเขตที่ยังไม่รองรับ

| ความต้องการ | สถานะรุ่นนี้ |
| --- | --- |
| World coordinates / parallax / depth ordering / camera keyframes | ใช้งานได้ใน scene ที่มี Blueprint |
| Walk/run กับ rig เดิม / ระยะเดินสัมพันธ์กับ phase / หยิบ–ถือ–วางหนังสือ / ประตู | ใช้งานได้; ยังไม่ใช่ foot-contact solver หรือ physics collision สมบูรณ์ |
| แสงไฟฉายตามมือ / หมอก / การปรับความเข้มแสงตามเวลา | ใช้งานได้แบบ 2D; ไม่ใช่ ray tracing หรือ ambient occlusion เชิงกายภาพ |
| มุม/การเคลื่อนกล้องทั้งหมด | รองรับ path, follow, pan/tilt/zoom/roll; ไม่รองรับ true 3D orbit หรือการสร้างด้านที่ asset ไม่มี |
| วิดีโอ → ความหมายทุกวัตถุ/ตัวละคร/ท่าทาง | ยังไม่รองรับอัตโนมัติ; unknown fields เป็น null พร้อมข้อจำกัด |
| บทภาษาไทยอิสระ → วิดีโอครบอัตโนมัติ | ยังไม่ครบ; ใช้ explicit timed directions หรือ Blueprint ที่ AI ครู/ผู้ใช้ตรวจแล้ว |
| การฝึกโมเดลจากคลิป | ไม่ได้ฝึก; เก็บกฎ/แผน/ตัวอย่างผลตรวจแยกจากโมเดลเดิม |
| หลัง-render ตรวจอวัยวะผิดรูป/ความหมายผิด/การชนทุกชนิด | ยังไม่รองรับ semantic vision; ตรวจตัวเลข/พิกเซล/เสียงและให้คนดูภาพร่วม |
| Lip-sync จริง | ยังคงข้อจำกัดของระบบเสียงเดิม ไม่ได้เพิ่ม phoneme alignment |
| เรนเดอร์ซ่อมเฉพาะช่วงภาพเสีย | แก้ข้อมูลเฉพาะฉากได้ แต่ export ยังเรนเดอร์ตามขอบเขตเดิม ไม่ใช่ partial video cache |

QA ที่ทำได้จริง: schema/ID/time/asset ที่ไม่รองรับ, ตัวละครนอกกรอบ, มือเอื้อมไม่ถึง, prop drift, ภาพใกล้ดำ/ขาว, ช่วงภาพเหมือนกัน, aspect/FPS, stream เสียงหายหรือเงียบ มี time/scene/element เมื่อข้อมูลเอื้อ ไม่ตีความช่วงเงียบหรือภาพนิ่งว่าเป็นข้อผิดพลาดเสมอ

## การทดสอบและหลักฐาน

- `node --test tests/cinematic-core.test.cjs tests/cinematic-render-qa.test.cjs`: ขอบกล้องทุก aspect, parallax, deterministic seek, gait phase, IK, การถือ/วาง, schema ผิด, unknown prose, การรักษาเวลาใน pipeline และ fault injection บนวิดีโอจริง
- `node tests/cinematic-preview-parity.cjs`: เปรียบเทียบพิกเซลพรีวิว SVG กับ export ทั้ง 9:16/16:9 และตรวจว่าพิกเซลซับอยู่ในพื้นที่ล่าง
- `node tests/cinematic-browser-smoke.cjs`: UI 320/390/768/1440, reviewed apply/undo, ทุกฉาก A–E, export จาก browser แล้ว H.264/AAC ด้วย FFmpeg แบบเดียวกับ worker, วิเคราะห์ไฟล์ 540×960 30 FPS 12s จริง
- เสียงในวิดีโอ QA เป็น **440 Hz test tone ไม่ใช่เสียงพากย์ AI** เพื่อพิสูจน์ audio path โดยไม่เรียกบริการภายนอก
- เทสต์เดิมที่ตรวจร่วม: cinematic FX, character interaction, production pipeline, audio export integrity, cloud browser export/contract, OAuth roles, navigation และ regional S3 presigning
- Build ใช้คำสั่งทั้งหมดจาก `amplify.yml` จริง พร้อม asset copy และ cache-busting stamp
- `.github/workflows/cinematic-engine-qa.yml` เก็บวิดีโอ/เฟรม/รายงานเป็น artifact 7 วัน

AWS CodeBuild/Amplify จริงขึ้นกับสิทธิ์และการตั้งค่าเดิม การผ่านการทดสอบ local ไม่ใช่หลักฐานว่า cloud deploy สำเร็จ ให้ตรวจ commit/build หลัง push แยกต่างหาก
