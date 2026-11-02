# AI Teacher Studio — ใช้งานจริงบน AWS

หน้าใหม่อยู่ภายใน **AI Production → AI ครู / API** รองรับมือถือและเดสก์ท็อป พร้อมพรีวิวเดิมและเครื่องมือเก่า

## สิ่งที่พัฒนาแล้ว

- แชตกับ AI ครูไทย/อังกฤษ ส่งบริบท JSON ของตอนและฉากที่เลือก (ไม่ส่ง audio data, media data, API keys)
- คำสั่งลัด 6 ประเภท กดครั้งเดียวเพื่อเรียก AI ครูผ่าน API
- OpenRouter, Google Gemini และ OpenAI-compatible API ที่โดเมนได้รับอนุญาต
- หน้าใส่ API key แบบชั่วคราว ส่งผ่าน session HTTPS แล้วเก็บใน AWS SSM SecureString หรือ AWS Secrets Manager
- คำตอบจากโมเดลเป็น **ข้อเสนอ** ไม่ใช่คำสั่งลบหรือ deploy; อนุญาต updateScene เฉพาะ duration, notes, voiceover, subtitle; ต้องให้ผู้ใช้ยืนยัน มีการตรวจ dry-run, ตรวจว่า scene ยังไม่เปลี่ยน และสำรอง JSON ก่อนใช้
- บันทึกผลเลือก/ไม่เลือกใน DynamoDB เมื่อ provision แล้ว; ดูประวัติได้โดยไม่ใช้ที่เก็บข้อมูลมือถือ; **ไม่ใช่การฝึกน้ำหนักโมเดล**
- ยังไม่รองรับการสั่งเรนเดอร์ทั้งหมดจาก AI ครู, วิเคราะห์ไฟล์ MP4 แบบรู้ภาพจริง, สั่งฝึกน้ำหนักโมเดลจากหน้าเว็บ หรือรัน Agent พื้นหลังต่อเนื่อง ข้อความในแชตห้ามอ้างว่าทำสิ่งเหล่านี้สำเร็จ

## วิธีติดตั้ง (AWS CloudShell)

เปิด CloudShell ในบัญชีเดียวกับ Lambda เดิม ใช้โค้ดโปรเจกต์เวอร์ชันล่าสุดหลังรวม PR:

```bash
cd ~/AI-ANIMATION
git pull --ff-only origin main
bash autodub/deploy.sh https://main.d1wc6w01kiwpnk.amplifyapp.com
bash autodub/setup-teacher.sh
```

ถ้าติดตั้งเว็บผ่าน Amplify แล้ว ให้ตรวจว่า environment variable **STORY_STUDIO_API_URL** ชี้ Lambda Function URL เดิม (สคริปต์ deploy พยายามตั้งให้อัตโนมัติ) และรอ Deploy เสร็จ ก่อนเปิดเว็บ

**หมายเหตุค่าใช้จ่าย:** AWS Lambda, DynamoDB และ SSM SecureString มีโควตา/การคิดค่าใช้จ่ายตามบัญชีและปริมาณใช้งาน; ค่าใช้จ่ายไม่ได้รับประกันว่าเป็นศูนย์ สคริปต์จะสร้างตาราง DynamoDB แบบ On-demand หนึ่งตารางและ SSM Standard SecureString หนึ่งตัว ผู้ใช้ควรตั้ง AWS Budget และใช้เฉพาะโมเดล API ฟรีก่อน รันคำสั่งด้วยบัญชี AWS ที่ได้รับอนุญาตเท่านั้น

สคริปต์ตั้ง IAM สิทธิ์จำกัดเฉพาะ SSM parameter และตาราง DynamoDB ใหม่ และรักษาคีย์เดิมเมื่อรันซ้ำ ไม่เขียนคีย์ลง GitHub/Amplify/static file

## การเชื่อม AI

1. เข้าเว็บและเข้าสู่ระบบด้วยรหัสผ่านสตูดิโอเดิม
2. ไป **AI Production → AI ครู / API → เชื่อม API**
3. เลือก OpenRouter หรือ Gemini, ใส่ Model ID และ API key แล้วกด **บันทึกและเชื่อมต่อ**
4. ไป **คุย / สั่งงาน** เลือก AI ครู แล้วพิมพ์หรือกดคำสั่งลัด
5. AI ครูแสดงคำตอบและอาจเสนอแก้ฉาก กด **ตรวจและใช้ข้อเสนอ** เฉพาะเมื่อถูกต้อง
6. ดูตัวอย่างที่บันทึกในแท็บ **ความจำ AI ลูก**; คำตอบเหล่านี้เป็น training feedback เท่านั้น ยังไม่ฝึกน้ำหนักโดยอัตโนมัติ

**แนะนำเริ่มต้น OpenRouter:** เลือกโมเดลที่มี `:free` เท่านั้น เซิร์ฟเวอร์ปฏิเสธ OpenRouter โมเดลเสียเงินเป็นค่าเริ่มต้น ผู้ให้บริการอาจเปลี่ยนโควตาหรือยกเลิกโมเดลได้ ส่วน Gemini ต้องตรวจเงื่อนไข Free Tier และการใช้ข้อมูลของบัญชีให้ชัดก่อนเชื่อม คำสั่งภาษาอังกฤษช่วยลดข้อความคำสั่งได้บางกรณี แต่เนื้อเรื่อง/บทพากย์ภาษาไทยต้องอ่านจากต้นฉบับไทย

### Custom OpenAI-compatible API

เพื่อป้องกัน SSRF เซิร์ฟเวอร์ไม่เรียก URL อิสระ ต้องกำหนด hostname ให้ชัดบน AWS ก่อน เช่น:

```bash
export TEACHER_ALLOWED_API_HOSTS="api.example.com"
bash autodub/setup-teacher.sh
```

จากนั้นจึงกรอก `https://api.example.com/v1` ในหน้าเชื่อม API ชื่อโฮสต์ตัวอย่างต้องเปลี่ยนเป็นโฮสต์จริงที่เชื่อถือได้ และต้องเป็น HTTPS

### การเก็บข้อมูลฝึก

- Database: DynamoDB ตาราง `story-studio-teacher-feedback` (ค่าเริ่มต้น), partition key `pk`, sort key `sk`
- Credential store: SSM Standard SecureString `/story-studio/teacher-settings` (ค่าเริ่มต้น)
- Feedback: ต้นคำขอ ผลตอบ และสถานะ approved / rejected / needs-review (ไม่แนบไฟล์ภาพหรือไฟล์เสียง)
- การอนุมัติ *ไม่ใช่* การเปลี่ยนน้ำหนักโมเดล จำเป็นต้องสร้าง curated training dataset, แบ่ง train/test ตามเรื่อง และผ่าน QA ก่อนเริ่มฝึก
- คีย์ API ไม่อยู่ในโปรเจกต์ JSON หรือ UI หลังส่ง และไม่ควรนำไปใส่ GitHub Secrets โดยไม่จำเป็น
- AWS DynamoDB/SSM เป็นแหล่งเก็บบนคลาวด์; ถ้าไม่ได้รัน `setup-teacher.sh` จะไม่อ้างว่าบันทึก feedback สำเร็จ
- หน้าเว็บเดิมยังใช้ IndexedDB/localStorage สำหรับโปรเจกต์ ไม่ใช่ Cloud Save ทั้งระบบ

## ตรวจสอบ

```bash
node --check studio-teacher.js
node --test tests/teacher-studio-contract.test.cjs
python3 tests/test_teacher_backend.py
```

งานนี้สร้างผ่าน PR ก่อน merge เพื่อไม่ให้กระทบระบบเสียง พรีวิว และการส่งออกเดิม
