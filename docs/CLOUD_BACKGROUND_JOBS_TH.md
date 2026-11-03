# AI-ANIMATION — งานสอน AI เบื้องหลังบน AWS (Cloud Background Jobs)

## ใช้ทำอะไร

- นำเข้า JSON → AI ลูกตรวจทั้ง JSON → เริ่มสอนบน AWS (ปิดเว็บได้)
- AWS Step Functions Standard ควบคุมลำดับงาน, Wait ระหว่างชุด และเรียก Lambda สอนครั้งละสูงสุด 2 ฉาก
- DynamoDB บันทึกต้นฉบับ/สถานะ/ผลลัพธ์แบบ Checkpoint และตรวจบทเรียนเดิมก่อนเรียกโมเดลซ้ำ
- ปิด Safari, เปลี่ยน Wi-Fi/5G, โทรศัพท์ดับ, เว็บ Deploy ใหม่: งานที่เริ่มบน Cloud แล้วไม่ต้องใช้แท็บคุม
- กลับเข้าเว็บด้วย GitHub เจ้าของ → AI ครู / API → สอน AI ลูก: โหลดสถานะจาก AWS อัตโนมัติ
- ปุ่ม พักงาน, ทำต่อจากฉากที่ค้าง, ยกเลิกงาน, รีเฟรชสถานะ AWS
- หากเกิด HTTP 429 ระบบ Wait แบบ Backoff ก่อนเรียกอีกครั้ง; หลังถูกจำกัดซ้ำหลายครั้งต้องกดทำต่อเอง
- ส่งออก JSON ที่ AI แม่แก้แล้วได้หลังบทเรียนทุกฉากผ่าน QA และตรงกับ JSON ปัจจุบัน

## ติดตั้งครั้งเดียว (เจ้าของ AWS)

เงื่อนไข: GitHub Actions ของ PR นี้รวมเข้า main และ Deploy AWS ผ่านแล้ว, บัญชี GitHub OAuth admin ทำงาน และระบบ AI ครูเชื่อม API พร้อมใช้งานก่อนหน้าแล้ว

เปิด AWS CloudShell Sydney (ap-southeast-2) แล้วคัดลอกคำสั่งนี้ครั้งเดียว:

    cd ~ && (test -d AI-ANIMATION/.git || git clone https://github.com/tanawutmalirum29-ux/AI-ANIMATION.git AI-ANIMATION) && cd AI-ANIMATION && git checkout main && git pull --ff-only origin main && bash autodub/setup-cloud-jobs.sh

สคริปต์จะ:
1. ตรวจตาราง DynamoDB เดิมและ Lambda เดิม; ไม่ลบข้อมูลหรือคีย์
2. สร้าง/อัปเดต IAM Role สิทธิ์จำกัด, Step Functions Standard State Machine
3. เปิดสิทธิ์ Lambda ให้เขียน Checkpoint ใน DynamoDB และเรียก Step Functions
4. รักษา Environment variables เดิม เพิ่ม TEACHER_JOB_STATE_MACHINE_ARN และตั้ง Lambda timeout 90 วินาที
5. ยืนยันสถานะ CLOUD JOBS READY

หากยังไม่รันสคริปต์ หน้าเว็บยังใช้วงจรสอนผ่านเบราว์เซอร์แบบเดิม ซึ่งปิดเว็บแล้วงานหยุด เว็บต้องระบุเรื่องนี้ชัดเจน

## ทดสอบหลังติดตั้ง

1. โหลด JSON ขนาด 1–2 ฉากก่อน กดตรวจทั้ง JSON แล้วกดเริ่มสอนบน AWS
2. ตรวจในหน้าเว็บว่าขึ้น AWS Background Jobs, สถานะ queued/running, สุดท้าย completed
3. ทดสอบปิดแท็บ/สลับเครือข่าย/รีเฟรช แล้วกลับมา: สถานะต้องไม่ย้อนกลับ
4. ทดสอบพักและทำต่อระหว่างรอบการสอน; บทเรียนที่บันทึกแล้วต้องไม่ถูกคิดเป็นงานใหม่
5. ตรวจ CloudWatch หรือ Step Functions executions หากงานอยู่ needs-attention หรือไม่เดินหน้า
6. เมื่อผ่านแล้วจึงสอน JSON ยาว 293 ฉาก

## ประหยัดค่าใช้จ่ายและข้อจำกัด

- โทรศัพท์ยังตรวจ JSON เบื้องต้นในเบราว์เซอร์ เพื่อไม่ใช้ Lambda สำหรับงานที่ทำได้ในเครื่อง
- AI Provider ถูกเรียกจาก AWS เฉพาะการสอนที่จำเป็น; AWS รอระหว่างงานด้วย Step Functions Wait ไม่เปิด Lambda ค้างไว้
- ระบบใช้ความจำบทเรียนเดิมด้วย fingerprint และบันทึกผลที่ผ่านแล้ว เพื่อลดการเรียก AI ซ้ำ
- ค่าบริการ Step Functions Standard, Lambda, DynamoDB และ AI Provider อาจเกิดขึ้นจริง ขึ้นกับ Free Tier/ปริมาณงาน/บัญชี ต้องติดตั้ง AWS Budget แจ้งเตือน
- งานที่เริ่มด้วยโหมด Browser เดิมไม่ย้ายเป็น Cloud โดยอัตโนมัติ ต้องกดเริ่ม Cloud Job ใหม่เมื่อระบบพร้อม โดยข้อมูลบทเรียน AWS เดิมยังใช้ซ้ำได้
- งานที่รันก่อนสั่งยกเลิก/พัก อาจจบชุดปัจจุบันก่อนหยุด; แสดงจำนวนที่ AWS บันทึกจริงเสมอ
- GitHub OAuth ต้องยืนยันว่าเป็นผู้ดูแลจาก user ID จริง; สมาชิกทั่วไปใช้คำสั่ง Cloud Job ไม่ได้
- Cloud state และ JSON อยู่ใน AWS ไม่ใช่ใน localStorage; ต้องเก็บความปลอดภัย IAM/DynamoDB เหมือนข้อมูลโปรเจกต์อื่น

## ตรวจสอบ CI / Deploy

GitHub Actions:
- AI Teacher Studio QA (รวม Python และ Node regression tests)
- Deploy AWS Studio automatically อัปเดตเฉพาะ Lambda Code เพื่อรักษาคีย์ OAuth/API และ Environment
- Amplify main สามารถ Deploy หน้าเว็บได้ตามปกติโดยไม่กระทบ Step Functions Execution ที่เริ่มแล้ว
