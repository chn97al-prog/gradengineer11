// api/submit-order.js

export default async function handler(request, response) {
  // تفعيل الـ CORS لتجنب مشاكل المتصفح
  response.setHeader('Access-Control-Allow-Credentials', true);
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  response.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // جلب المتغيرات السرية بأمان من إعدادات Vercel
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
    const TELEGRAM_BATCH_CHAT_ID = process.env.TELEGRAM_BATCH_CHAT_ID;
    const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

    const data = request.body;
    let { actionType } = data;

    // 1️⃣ دالة لإنشاء موضوع بالتليجرام
    const createTelegramTopic = async (topicName) => {
      try {
        const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/createForumTopic`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: TELEGRAM_BATCH_CHAT_ID, name: topicName })
        });
        const resJson = await res.json();
        if (resJson.ok) return resJson.result.message_thread_id;
      } catch (err) { console.error("خطأ تليجرام:", err); }
      return null;
    };

    // 2️⃣ دالة إرسال الصور
    const sendBase64PhotoToTelegram = async (imageData, caption, targetChatId, threadId = null) => {
      if (!imageData || !imageData.base64) return;
      try {
        const formData = new FormData();
        formData.append("chat_id", targetChatId);
        formData.append("caption", caption);
        if (threadId) formData.append("message_thread_id", threadId);

        const binaryString = atob(imageData.base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: imageData.mimeType || 'image/jpeg' });
        formData.append("photo", blob, imageData.filename || 'photo.jpg');

        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, { method: 'POST', body: formData });
      } catch (err) { console.error("خطأ إرسال الصورة:", err); }
    };

    // 3️⃣ دالة إرسال الرسائل النصية
    const sendTelegramMessage = async (text, targetChatId, threadId = null) => {
      try {
        const payload = { chat_id: targetChatId, text, parse_mode: "Markdown" };
        if (threadId) payload.message_thread_id = threadId;
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      } catch (err) { console.error("خطأ إرسال الرسالة:", err); }
    };

    // 4️⃣ دالة جوجل شيت
    const sendToGoogleSheet = async (payload) => {
      if (!GOOGLE_SCRIPT_URL) return null;
      try {
        await fetch(GOOGLE_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: JSON.stringify(payload)
        });
      } catch (err) { console.error("خطأ جوجل شيت:", err); }
    };

    if (!actionType) actionType = "SINGLE_ORDER";

    // معالجة تأسيس الدفعة
    if (actionType === "CREATE_BATCH") {
      const topicName = `دفعة_${data.batchCode}`;
      const threadId = await createTelegramTopic(topicName);
      const text = `👑 **تأسيس دفعة جديدة** 👑\n🔢 كود الدفعة: \`${data.batchCode}\`\n👤 الممثل: ${data.repName}\n🏫 الجامعة: ${data.uniName}`;
      await sendTelegramMessage(text, TELEGRAM_BATCH_CHAT_ID, threadId);
      if (data.uniLogo) await sendBase64PhotoToTelegram(data.uniLogo, `شعار الجامعة`, TELEGRAM_BATCH_CHAT_ID, threadId);
      await sendToGoogleSheet({ ...data, telegramThreadId: threadId });
      return response.status(200).json({ success: true });
    }

    // معالجة الانضمام للدفعة
    if (actionType === "JOIN_BATCH") {
      const verify = await fetch(`${GOOGLE_SCRIPT_URL}?actionType=VERIFY_BATCH&batchCode=${data.batchCode}`);
      const vData = await verify.json();
      const threadId = vData.success ? vData.batchData.telegramThreadId : null;

      const text = `🤝 **انضمام طالب جديد للدفعة (${data.batchCode})** 🤝\n👤 الطالب: ${data.studentName}\n✍️ الوشاح: ${data.sashText}`;
      await sendTelegramMessage(text, TELEGRAM_BATCH_CHAT_ID, threadId);
      if (data.images) {
        await sendBase64PhotoToTelegram(data.images.sashBackImg, `الظهر`, TELEGRAM_BATCH_CHAT_ID, threadId);
        await sendBase64PhotoToTelegram(data.images.capTopImg, `القبعة`, TELEGRAM_BATCH_CHAT_ID, threadId);
      }
      await sendToGoogleSheet(data);
      return response.status(200).json({ success: true });
    }

    // معالجة الطلب الفردي
    if (actionType === "SINGLE_ORDER") {
      const text = `✨ **طلب فردي جديد** ✨\n👤 الاسم: ${data.studentName}\n📞 الهاتف: ${data.phone}\n📐 القياسات: طول ${data.lengthGown} | ردن ${data.lengthSleeve}`;
      await sendTelegramMessage(text, TELEGRAM_CHAT_ID);
      if (data.images) {
        await sendBase64PhotoToTelegram(data.images.sashBackImg, `الظهر`, TELEGRAM_CHAT_ID);
        await sendBase64PhotoToTelegram(data.images.capTopImg, `القبعة`, TELEGRAM_CHAT_ID);
      }
      await sendToGoogleSheet(data);
      return response.status(200).json({ success: true });
    }

  } catch (error) {
    return response.status(500).json({ success: false, error: error.message });
  }
}
