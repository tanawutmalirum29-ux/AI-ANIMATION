# GitHub OAuth — สิทธิ์แอดมินและสมาชิก 6 AI

## สิทธิ์

- GitHub User ID `225819900` คือแอดมิน `tanawutmalirum29-ux` ตรวจจาก GitHub API จริง ไม่เชื่อ username ที่ส่งจากเว็บ
- GitHub บัญชีอื่นเป็นสมาชิกทั่วไป ใช้ได้เฉพาะ AI-1…AI-6 แยกงาน นำเข้า JSON และเชื่อม Gemini/OpenRouter ด้วย API Key ส่วนตัว
- สมาชิกทั่วไปถูกบล็อก `teacher.*`, `student.*`, `export.*`, `proposeAsset` และ TTS ของแอดมินที่ Lambda (HTTP 403)
- ผู้ช่วย 6 ตัวเป็นหกบทบาทงาน ไม่ใช่หก LLM ฝึกแยกกัน
- คีย์ของสมาชิกอยู่ใน RAM ของแท็บเท่านั้น ไม่เก็บลง AWS / localStorage; รีโหลดต้องกรอกใหม่
- ประวัติงานของสมาชิกเก็บ localStorage แยกตาม GitHub ID ไม่ใช่ Cloud Save และไม่เหมาะสำหรับข้อมูลลับบนเครื่องที่แชร์กัน

## ตั้งค่า GitHub OAuth App ครั้งเดียว

เปิด https://github.com/settings/developers → OAuth Apps → New OAuth App

- Application name: AI-ANIMATION
- Homepage URL: `https://main.d1wc6w01kiwpnk.amplifyapp.com/`
- Authorization callback URL: `https://main.d1wc6w01kiwpnk.amplifyapp.com/`
- กดสร้างและรับ Client ID แล้ว Generate new client secret

หลัง GitHub Actions Deploy โค้ดล่าสุดเป็น Success ให้เปิด AWS CloudShell Sydney แล้วรัน:

```bash
cd ~ && (test -d AI-ANIMATION/.git || git clone https://github.com/tanawutmalirum29-ux/AI-ANIMATION.git AI-ANIMATION) && cd AI-ANIMATION && git checkout main && git pull --ff-only origin main && bash autodub/setup-github-oauth.sh
```

CloudShell จะถาม Client ID และ Client Secret แบบซ่อนข้อความ คีย์ถูกเก็บเป็น AWS SSM SecureString และเพิ่มสิทธิ์อ่านเฉพาะพารามิเตอร์นั้นให้ Lambda อย่าส่งคีย์ในแชตหรือ GitHub

**ก่อนตั้งค่าครบ:** รหัสผ่านเดิมยังเปิดใช้เพื่อไม่ให้เจ้าของถูกล็อกออก
**หลังตั้งค่าครบ:** เว็บขึ้นปุ่มเข้าสู่ระบบ GitHub และ Backend ปฏิเสธการเข้าสู่ระบบด้วยรหัสผ่านเดิม

ทดสอบด้วย GitHub เจ้าของและบัญชีอื่นแยกกัน บัญชีทั่วไปต้องไม่เห็น Studio แอดมิน และ API แอดมินต้องตอบ 403 แม้เรียกโดยตรง

## ความปลอดภัย

- GitHub OAuth PKCE S256, nonce/state ตรวจใน browser, Client Secret ที่ฝั่ง AWS, ตรวจตัวตนด้วย `/user`
- เซสชันลงนาม HMAC หมดอายุใน 4 ชั่วโมง; ออกจากระบบลบ token ในแท็บ แต่ token ที่ถูกคัดลอกยังมีอายุจนหมดเวลา (ยังไม่มี server-side denylist)
- เว็บไซต์แบบ static ยังโหลดโค้ด public ได้ แต่ AWS ป้องกันคำสั่งและข้อมูลส่วนตัวฝั่งเซิร์ฟเวอร์
- การใช้ API ของตนเองอาจติดโควตาหรือมีค่าใช้จ่าย; ระบบไม่ได้จ่ายแทนสมาชิก
- GitHub OAuth Login แยกจาก GitHub OIDC Role สำหรับ Deploy
