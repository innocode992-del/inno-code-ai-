# Inno Code — نسخة GitHub + Vercel

النسخة دي جاهزة للنشر على Vercel. لا تحتاج `START-WINDOWS.bat` ولا سيرفر محلي ولا مكتبات npm.

## 1) ارفع الملفات إلى GitHub

- فك ضغط `Inno-Code-Vercel.zip` على جهازك.
- ارفع **محتويات المجلد نفسها** إلى جذر المستودع المرتبط بـ Vercel، وليس مجلد `Inno-Code-Vercel` كمجلد فرعي.
- يجب أن يظهر في جذر المستودع: `index.html` ومجلدا `api` و`assets`.
- اعمل Commit / Push. Vercel سيبدأ Deployment جديدًا تلقائيًا إذا كان الربط مفعّلًا.

## 2) اضبط إعدادات مشروع Vercel

إذا كنت تنشئ مشروعًا جديدًا من GitHub:
- Framework Preset: `Other`.
- Root Directory: المجلد الذي يحتوي مباشرة على `index.html`.
- Build Command: اتركه فارغًا (لا يوجد Build مطلوب).
- Output Directory: `.` إذا طلبت الواجهة تحديده.

إذا كان عندك مشروع Vercel موجود، تأكد فقط أن Root Directory يشير إلى نفس المجلد الذي فيه `index.html` و`api/`.

## 3) أضف مفتاح OpenAI بأمان

من Vercel Dashboard:
1. افتح مشروع Inno Code.
2. Settings → Environment Variables.
3. أضف المتغير الأول:
   - Name: `OPENAI_API_KEY`
   - Value: مفتاح OpenAI API الخاص بك.
   - اختر Production وPreview (وDevelopment لو تحتاجه).
4. أضف المتغير الثاني:
   - Name: `OPENAI_MODEL`
   - Value: `gpt-6.2-sol`
5. احفظ المتغيرات.
6. افتح Deployments واعمل Redeploy لآخر Deployment؛ المتغيرات الجديدة لا تطبّق على Deployment قديم.

لا تضع مفتاح API في `index.html` أو `assets/app.js`، ولا ترفعه إلى GitHub، ولا تستخدم بادئة `NEXT_PUBLIC_` له.

## 4) اختبر الاتصال

افتح رابط موقعك ثم افتح:
`https://YOUR-VERCEL-DOMAIN/api/status`

لو ظهر JSON فيه `"configured":true` فالمفتاح موجود في إعدادات Function. بعد ذلك ارجع للصفحة وأرسل رسالة تجريبية.

## تنبيه مهم قبل مشاركة الرابط

مفتاح OpenAI محفوظ على السيرفر وليس في المتصفح، لكن مسار `/api/chat` نفسه متاح لزوار الموقع. لذلك لا تنشر الرابط للعامة قبل إضافة تسجيل دخول أو نظام تحديد استخدام/معدل طلبات؛ وإلا قد يستخدم آخرون رصيد API الخاص بك.

## ملاحظات

- الواجهة نصية فقط ولا تستخدم الميكروفون أو الصوت.
- سجل المحادثات محفوظ في متصفح المستخدم عبر Local Storage.
- الموديل الافتراضي `gpt-6.2-sol`. غيّره من `OPENAI_MODEL` إذا لم يكن متاحًا في حساب API الخاص بك.
- استخدام API له فوترة منفصلة عن اشتراك ChatGPT.
