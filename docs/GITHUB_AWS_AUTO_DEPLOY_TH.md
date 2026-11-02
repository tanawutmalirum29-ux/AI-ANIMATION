# ติดตั้งครั้งเดียว: GitHub Deploy AWS อัตโนมัติ + บันทึก API แม่ถาวร

## คำตอบแบบสั้น

- **ไม่ต้องรัน `git pull` + `bash autodub/deploy.sh` ใน CloudShell ทุกครั้ง** หลังติดตั้ง GitHub Actions → AWS OIDC **ครั้งเดียว** ทุกครั้งที่ส่งโค้ดเข้า `main` จะอัปเดต Lambda และให้ Amplify Deploy เอง
- **API Key ที่เชื่อม AI แม่เก็บไว้ใน AWS อยู่แล้ว** ผ่าน SSM SecureString (หรือ Secrets Manager หากผู้ดูแลตั้งไว้) ไม่หายตอนปิดเว็บ เปลี่ยนแท็บ รีเฟรช หรือออกจากระบบ Studio
- การล็อกอินกลับเข้า Studio อาจจำเป็นเมื่อเซสชันหมดอายุ แต่ **ไม่ต้องกรอกคีย์ของ Gemini/OpenRouter ใหม่** หน้า AI ครูจะโหลดสถานะที่ AWS บันทึกไว้และเลือกผู้ให้บริการที่เชื่อมแล้วให้อัตโนมัติ
- เมื่ออยากลบคีย์จริง ๆ ให้เข้า **AI ครู / API → เชื่อม API → ยกเลิกเชื่อมต่อ** และยืนยัน การลบมีผลเฉพาะผู้ให้บริการที่เลือก
- ไม่ต้องเก็บ AWS Access Key/Secret Key ใน GitHub อีกต่อไป

## เปิด Deploy AWS อัตโนมัติครั้งแรกเท่านั้น

ก่อนเริ่ม ตรวจว่า AWS Lambda `story-studio-autodub` ที่ Sydney และ Amplify app `d1wc6w01kiwpnk` มีอยู่แล้วตามการติดตั้งเดิม (สคริปต์ไม่สร้าง Lambda/Amplify ใหม่)

เปิด AWS CloudShell **region ap-southeast-2** แล้วใช้คำสั่งเดียว:

```bash
cd ~ && (test -d AI-ANIMATION/.git || git clone https://github.com/tanawutmalirum29-ux/AI-ANIMATION.git AI-ANIMATION) && cd AI-ANIMATION && git checkout main && git pull --ff-only origin main && bash autodub/setup-github-deploy.sh
```

สคริปต์สร้าง GitHub OIDC provider (ถ้ายังไม่มี) และ IAM role `story-studio-gha-deploy` โดยให้สิทธิ์ **เฉพาะ Push ไป branch main จาก repo นี้** ใช้สิทธิ์แก้โค้ด Lambda ที่มีอยู่ และจัดการ release ของ Amplify main เท่านั้น ไม่ให้สิทธิ์อ่าน SSM/Secrets Manager/DynamoDB และไม่ได้สร้าง AWS Access Key

หลังรัน:
- หาก CloudShell มี `gh` และล็อกอิน GitHub อยู่แล้ว ระบบจะตั้ง Actions variable `AWS_DEPLOY_ROLE_ARN` อัตโนมัติ
- หากยังไม่มี `gh` ให้เปิด <https://github.com/tanawutmalirum29-ux/AI-ANIMATION/settings/variables/actions> → **New repository variable**
  - **Name:** `AWS_DEPLOY_ROLE_ARN`
  - **Value:** คัดลอก ARN ที่ CloudShell แสดง `arn:aws:iam::<AWS_ACCOUNT_ID>:role/story-studio-gha-deploy`
  - กด Add variable

เพื่อทดลอง Deploy ครั้งแรก (หลังตั้งตัวแปร) เข้า
<https://github.com/tanawutmalirum29-ux/AI-ANIMATION/actions/workflows/deploy-aws-studio.yml>
→ **Run workflow** → branch `main` → **Run workflow** อีกครั้ง

จากนั้นทุกครั้งที่มี push/merge เข้าสู่ `main` GitHub Actions workflow **Deploy AWS Studio automatically** ทำงานเอง:
1. รับ credential อายุสั้นจาก OIDC (ไม่เก็บคีย์ AWS)
2. Bundle Lambda โค้ดทุกโมดูลล่าสุด และ Update Lambda **เฉพาะ Code** ไม่แตะค่า Environment, รหัสผ่านเว็บไซต์ หรือคีย์ AI แม่
3. ถ้า Amplify main เชื่อม GitHub และ `enableAutoBuild=true` ปล่อยให้ Amplify สร้างเว็บเองจาก push; ถ้า AutoBuild ปิด จะสั่ง Amplify RELEASE เอง

**ข้อจำกัด:** ต้องทำขั้นตอนเชื่อม AWS กับ GitHub ครั้งแรกก่อน จึงจะทำงานโดยอัตโนมัติจริง GitHub Actions อาจล้มเหลวหาก IAM/OIDC ถูกเปลี่ยน หรือ AWS/GitHub มีปัญหา ดูรายละเอียดได้ในแท็บ Actions ของ repo

## บันทึกคีย์ AI แม่

หน้าสำหรับดูข้อมูล: AI Production → AI ครู / API → **เชื่อม API** ด้านล่างจะแสดง **AI แม่ที่บันทึกไว้ถาวรบน AWS** พร้อมชื่อ provider/Model ID และปุ่ม **เลือกใช้งาน** กับ **ยกเลิกเชื่อมต่อ**

- ไม่ต้องกรอกคีย์ซ้ำในภายหลัง แม้ล็อกอินเว็บใหม่
- เปลี่ยนโมเดลด้วยคีย์เดิมได้ ไม่ต้องส่งคีย์ซ้ำ
- ยกเลิกเชื่อมต่อจะลบคีย์ของ provider นั้นออกจาก AWS ที่เก็บค่าของ Studio อย่างถาวร (ไม่ได้ไปเพิกถอน API Key ที่เว็บ Google/OpenRouter ต้นทาง; หากต้องการให้คีย์ใช้ไม่ได้ทุกที่ ให้เพิกถอนที่ผู้ให้บริการเอง)
- รายการบทเรียนใน DynamoDB ยังอยู่หลังยกเลิกเชื่อมต่อ เพื่อไม่ให้ข้อมูลฝึกสูญหาย
- **รหัสผ่านเข้าสู่เว็บไซต์ Studio กับ API Key ของ AI แม่คนละอย่างกัน** การล็อกอินใหม่ไม่ได้แปลว่าต้องเชื่อม API แม่ใหม่

ห้ามส่ง API Key, AWS Secret Access Key หรือรหัสผ่านผ่านแชต/ใส่ในไฟล์ GitHub
