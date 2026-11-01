# ฝึก AI ของเราเองผ่าน GitHub (ไม่ใช้เครื่องผู้ใช้ / ไม่ใช้ Model API)

## สิ่งที่ได้จากเฟสแรก

- GitHub Actions `CPU Layout ML (experimental)` จะ **ฝึกน้ำหนักจริงบน CPU ของ GitHub** ใน PR ที่แตะไฟล์เกี่ยวข้อง โดยใช้เฉพาะตัวอย่าง *สังเคราะห์* สำหรับทดสอบระบบ และเก็บไฟล์ `layout-demo-only.json` เป็น artifact 7 วัน
- ผลฝึกแสดงในแท็บ **Actions → CPU Layout ML → งานล่าสุด → Summary** พร้อมจำนวนตัวอย่างและคะแนนเทียบกฎเดิม
- ยังไม่มีตัวอย่างจริงที่ได้รับอนุมัติมากพอ จึง **ห้ามใช้โมเดล demo ในงานผลิตจริง**
- เพิ่ม `ml-runtime/layout-handler.cjs` เป็นโค้ด AWS Lambda Node.js แบบไม่มีแพ็กเกจภายนอก เพื่อรองรับโมเดลที่ผ่านการอนุมัติในอนาคต โมดูลนี้ **ยังไม่ถูก deploy และยังไม่มี endpoint สาธารณะ**

## วิธีดูการฝึกบน GitHub จากมือถือ

1. เปิด [GitHub Actions — CPU Layout ML](https://github.com/tanawutmalirum29-ux/AI-ANIMATION/actions/workflows/cpu-layout-ml.yml)
2. เมื่อมีการแก้ไฟล์ระบบ ML ผ่าน PR ให้เลือกงาน `cpu-train` แล้วดู **Summary** และดาวน์โหลด artifact `cpu-layout-ml-demo-pr`
3. ถ้าต้องการสั่งทดลองเอง เปิด **Run workflow → mode: demo → Run workflow** (ใช้เครื่อง GitHub ไม่ใช้ CPU/RAM โทรศัพท์)
4. ไฟล์ตัวอย่าง `layout-demo-only.json` มี `active:false`, `status:demo-only` และมีน้ำหนัก SGD ที่ฝึกจริง แต่ยังไม่ใช่โมเดลใช้งาน

## วิธีเก็บตัวอย่างฝึกของจริง

1. เปิดเว็บ AI-ANIMATION แล้วนำเข้า JSON หลายเรื่อง
2. ไปที่ **AI Production → ML Lab** เลือกยืนยันว่าตัวละครอยู่ถูกแล้ว หรือแก้ระยะห่างก่อนกดเก็บตัวอย่าง
3. เว็บจะดาวน์โหลดไฟล์ `.jsonl` ที่มีแต่คุณลักษณะ 8 ค่า ไม่แนบวิดีโอ/เสียง/ข้อความบท ต้องให้คนตรวจผลลัพธ์ก่อนทุกครั้ง
4. ตั้งเป้า **อย่างน้อย 60 ตัวอย่างจริง จากอย่างน้อย 5 เรื่อง** มีทั้ง `keep` และ `separate`; ต้องแบ่งกลุ่มข้อมูลจาก *คนละเรื่อง* เพื่อวัดผลจริง
5. รวมข้อมูลด้วย `training-lab/prepare-layout-data.py` ก่อนสร้าง `training-lab/datasets/approved/layout-spacing.jsonl` **อย่านำข้อมูลเข้าที่เก็บ GitHub สาธารณะโดยไม่ยินยอม**
6. เมื่อข้อมูลพร้อม ไปที่ Actions เลือก **Run workflow → mode: approved** เพื่อฝึก CPU ด้วยตัวอย่างจริง
7. แม้ผ่านเกณฑ์ `candidate-review` ก็ยัง **ไม่ auto deploy** ต้องตรวจรุ่นที่ผ่านด้วยเรื่องใหม่และอนุมัติรุ่นก่อน

## เมื่อพร้อมเปิด AI ฝั่ง AWS (ยังไม่ใช่ขั้นที่ต้องทำวันนี้)

มี handler ที่ `ml-runtime/layout-handler.cjs` สำหรับ AWS Lambda Node.js 22+ รับ POST JSON รูปแบบ:

```json
{"features":{"gapX":0.12,"gapY":0.05,"portrait":1,"count":0.25,"moving":0,"interaction":0,"locked":0,"edge":0.4}}
```

และคืน `probabilitySeparate` กับคำแนะนำ `review-separation` หรือ `no-automatic-change` เท่านั้น **ไม่ปรับฉากเอง**

เงื่อนไขการเปิดใช้งาน:
- ต้องเป็นโมเดลที่ฝึกจากมนุษย์อนุมัติ `training.mode=approved` มีคะแนน holdout และมีคนอนุมัติให้เปลี่ยน `status=approved`, `active=true` หลังทดสอบกับเรื่องใหม่แล้ว
- Lambda ต้องได้รับ `AI_LAYOUT_MODEL_JSON` จากขั้นตอนโปรโมตที่ผู้ดูแลอนุญาต ไม่ใช้ไฟล์ demo หรือ candidate ที่ยังไม่ผ่าน
- สร้าง Lambda/ API Gateway พร้อม **Cognito/IAM หรือ authorization ฝั่งเซิร์ฟเวอร์**; **ห้ามเปิด Function URL แบบ NONE หรือฝังคีย์ลับ AWS ลงในหน้าเว็บ**; ควบคุมอัตราการเรียกและตั้ง AWS Budget
- ไม่มีการใช้ API ของ OpenAI/Gemini/ผู้ให้บริการโมเดลสำเร็จรูป; แต่ AWS Lambda ยังคิดค่าใช้งานตามทรัพยากรได้
- GitHub Actions ใช้สำหรับฝึกตามรอบ ไม่ใช่ endpoint เรียลไทม์; โค้ด Lambda นี้ยังไม่ได้ผูกกับ AWS/Amplify และไม่มีค่าใช้จ่าย AWS จากการแก้ GitHub ครั้งนี้

## คำตอบสั้น ๆ ว่าตอนนี้ต้องทำอะไร

**ตอนนี้ไม่ต้องรันโค้ดบนโทรศัพท์หรือเปิด AWS เพิ่ม** ดูผลการฝึก demo ใน GitHub Actions และเริ่มรวบรวมข้อมูลจริงผ่านปุ่ม ML Lab บนเว็บ เมื่อมีชุดข้อมูลจริงจึงฝึกรุ่น `approved` และหลังจากผ่าน QA ค่อยเชื่อม AWS

## ความสามารถที่ยังไม่มี

โมเดลนี้แก้โจทย์ **ระยะห่างตัวละคร** เท่านั้น ไม่ใช่ LLM ที่แต่งบท/สร้าง SVG/วาดภาพได้เอง การพัฒนาความสามารถอื่นต้องมีข้อมูลป้ายกำกับและชุดทดสอบแยกเฉพาะเรื่อง
