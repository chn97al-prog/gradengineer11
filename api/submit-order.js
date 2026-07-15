// api/submit-order.js

module.exports = async function handler(request, response) {
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
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
    const TELEGRAM_BATCH_CHAT_ID = process.env.TELEGRAM_BATCH_CHAT_ID;
    const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

    const data = request.body;
    let { actionType } = data;
    if (!actionType) actionType = "SINGLE_ORDER";

    // --- الدوال الأساسية للإرسال ---
    
    // إرسال رسالة نصية
    const sendTelegramMessage = async (text, targetChatId, threadId = null) => {
      try {
        const payload = { chat_id: targetChatId, text, parse_mode: "Markdown" };
        if (threadId) payload.message_thread_id = threadId;
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      } catch (err) { console.error("خطأ إرسال الرسالة النصية:", err); }
    };

    // إرسال صورة
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

    // إرسال البيانات لجوجل شيت
    const sendToGoogleSheet = async (payload) => {
      if (!GOOGLE_SCRIPT_URL) return;
      try {
        await fetch(GOOGLE_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: JSON.stringify(payload)
        });
      } catch (err) { console.error("خطأ جوجل شيت:", err); }
    };

    // ==========================================
    // 1️⃣ معالجة تأسيس الدفعة (CREATE_BATCH)
    // ==========================================
    if (actionType === "CREATE_BATCH") {
      // نحتاج لإنشاء الـ Topic أولاً بالتسلسل للحصول على الـ threadId
      let threadId = null;
      try {
        const topicRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/createForumTopic`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: TELEGRAM_BATCH_CHAT_ID, name: `دفعة_${data.batchCode}` })
        });
        const resJson = await topicRes.json();
        if (resJson.ok) threadId = resJson.result.message_thread_id;
      } catch (err) { console.error("فشل إنشاء الـ Topic:", err); }

      const text = `👑 **تأسيس دفعة جديدة** 👑\n🔢 كود الدفعة: \`${data.batchCode}\`\n👤 الممثل: ${data.repName}\n🏫 الجامعة: ${data.uniName}`;

      // ⚡ إرسال الرسالة، الصورة، وكتابة جوجل شيت بالتوازي (Parallel) دون انتظار بعضها البعض!
      await Promise.all([
        sendTelegramMessage(text, TELEGRAM_BATCH_CHAT_ID, threadId),
        data.uniLogo ? sendBase64PhotoToTelegram(data.uniLogo, `شعار الجامعة`, TELEGRAM_BATCH_CHAT_ID, threadId) : Promise.resolve(),
        sendToGoogleSheet({ ...data, telegramThreadId: threadId })
      ]);

      return response.status(200).json({ success: true });
    }

    // ==========================================
    // 2️⃣ معالجة الانضمام للدفعة (JOIN_BATCH)
    // ==========================================
    if (actionType === "JOIN_BATCH") {
      // التحقق من كود الدفعة من جوجل شيت (يجب أن يكون بالتسلسل)
      const verify = await fetch(`${GOOGLE_SCRIPT_URL}?actionType=VERIFY_BATCH&batchCode=${data.batchCode}`);
      const vData = await verify.json();
      const threadId = vData.success ? vData.batchData.telegramThreadId : null;

      const text = `🤝 **انضمام طالب جديد للدفعة (${data.batchCode})** 🤝\n👤 الطالب: ${data.studentName}\n✍️ الوشاح: ${data.sashText}`;

      // ⚡ إرسال الإشعارات وحفظ البيانات بالتوازي فوراً
      await Promise.all([
        sendTelegramMessage(text, TELEGRAM_BATCH_CHAT_ID, threadId),
        data.images?.sashBackImg ? sendBase64PhotoToTelegram(data.images.sashBackImg, `الظهر`, TELEGRAM_BATCH_CHAT_ID, threadId) : Promise.resolve(),
        data.images?.capTopImg ? sendBase64PhotoToTelegram(data.images.capTopImg, `القبعة`, TELEGRAM_BATCH_CHAT_ID, threadId) : Promise.resolve(),
        sendToGoogleSheet(data)
      ]);

      return response.status(200).json({ success: true });
    }

    // ==========================================
    // 3️⃣ معالجة الطلب الفردي (SINGLE_ORDER)
    // ==========================================
    if (actionType === "SINGLE_ORDER") {
      const text = `✨ **طلب فردي جديد** ✨\n👤 الاسم: ${data.studentName}\n📞 الهاتف: ${data.phone}\n📐 القياسات: طول ${data.lengthGown} | ردن ${data.lengthSleeve}`;

      // ⚡ إرسال كل شيء بالتوازي فوراً
      await Promise.all([
        sendTelegramMessage(text, TELEGRAM_CHAT_ID),
        data.images?.sashBackImg ? sendBase64PhotoToTelegram(data.images.sashBackImg, `الظهر`, TELEGRAM_CHAT_ID) : Promise.resolve(),
        data.images?.capTopImg ? sendBase64PhotoToTelegram(data.images.capTopImg, `القبعة`, TELEGRAM_CHAT_ID) : Promise.resolve(),
        sendToGoogleSheet(data)
      ]);

      return response.status(200).json({ success: true });
    }

  } catch (error) {
    return response.status(500).json({ success: false, error: error.message });
  }
}
