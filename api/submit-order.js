// api/submit-order.js (Vercel Serverless Function) - إصدار فائق الاستقرار
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL; 
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN; 
const TELEGRAM_BATCH_CHAT_ID = process.env.TELEGRAM_BATCH_CHAT_ID;      // جروب الدفعات
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;  // قناة الفردي

module.exports = async function handler(req, res) {
  // ترويسات CORS لتجنب مشاكل المتصفح
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  // التحقق من متغيرات البيئة
  if (!GOOGLE_SCRIPT_URL || !TELEGRAM_BOT_TOKEN || !TELEGRAM_BATCH_CHAT_ID || !TELEGRAM_CHAT_ID) {
    return res.status(500).json({ 
      success: false, 
      error: "متغيرات البيئة غير مكتملة في Vercel. يرجى التأكد من الـ 4 متغيرات." 
    });
  }

  try {
    // 1. عملية فحص الكود (GET)
    if (req.method === "GET") {
      const { actionType, batchCode } = req.query;

      if (actionType === "VERIFY_BATCH") {
        if (!batchCode) {
          return res.status(400).json({ success: false, error: "كود الدفعة مطلوب" });
        }

        const targetUrl = `${GOOGLE_SCRIPT_URL}?actionType=VERIFY_BATCH&batchCode=${encodeURIComponent(batchCode)}`;
        const response = await fetch(targetUrl, { method: "GET" });
        const result = await response.json();
        
        return res.status(response.status).json(result);
      }
    }

    // 2. عمليات الإرسال والحفظ (POST)
    if (req.method === "POST") {
      // التأكد من استخراج الـ body كـ JSON بشكل سليم
      let body = req.body;
      if (typeof body === "string") {
        body = JSON.parse(body);
      }

      if (!body || !body.actionType) {
        return res.status(400).json({ success: false, error: "بيانات الطلب غير صالحة" });
      }

      // إرسال البيانات لجوجل شيت
      const response = await fetch(GOOGLE_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const result = await response.json();

      if (result.success) {
        // حالة تأسيس دفعة جديدة
        if (body.actionType === "CREATE_BATCH") {
          const newCode = result.batchCode;
          
          // إنشاء التوبك في تليجرام
          const threadId = await createTelegramTopic(newCode);
          
          // إرسال تفاصيل الدفعة للتوبك
          await sendTelegramMessage(
            TELEGRAM_BATCH_CHAT_ID,
            `👑 *تم تأسيس دفعة جديدة بنجاح!*\n\n` +
            `🔑 *كود الدفعة:* \`${newCode}\`\n` +
            `👤 *الممثل (الكامل):* ${body.repName}\n` +
            `📞 *الهاتف:* ${body.repPhone}\n` +
            `🏫 *الجامعة:* ${body.uniName} - ${body.collName}\n` +
            `🎨 *الموديل:* ${body.batchModel}`,
            threadId
          );
        }

        // حالة انضمام طالب جديد
        if (body.actionType === "JOIN_BATCH") {
          const batchCode = body.batchCode;

          // إرسال الإشعار لقناة الفردي
          await sendTelegramMessage(
            TELEGRAM_CHAT_ID,
            `🤝 *طالب جديد انضم للفردي!*\n\n` +
            `🔑 *كود الدفعة:* \`${batchCode}\`\n` +
            `👤 *اسم الطالب:* ${body.studentName}\n` +
            `✨ *اسم الوشاح:* ${body.sashText}\n` +
            `🎨 *تفاصيل التطريز:* ${body.sashBackText || "لا يوجد"}\n` +
            `➕ *الإضافات:* ${body.additions || "لا توجد"}`
          );
        }
      }

      return res.status(response.status).json(result);
    }

    return res.status(405).json({ success: false, error: "الطريقة غير مدعومة" });

  } catch (error) {
    console.error("خطأ سيرفر فيرسل:", error);
    return res.status(500).json({ success: false, error: "فشل في السيرفر: " + error.message });
  }
};

// دالة إنشاء التوبك بالتليجرام
async function createTelegramTopic(name) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/createForumTopic`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_BATCH_CHAT_ID,
        name: name 
      })
    });
    const data = await response.json();
    if (data.ok) {
      return data.result.message_thread_id; 
    }
    return null;
  } catch (err) {
    console.error("فشل إنشاء التوبك:", err);
    return null;
  }
}

// دالة إرسال الرسائل العامة
async function sendTelegramMessage(targetChatId, text, threadId = null) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const payload = {
      chat_id: targetChatId,
      text: text,
      parse_mode: "Markdown"
    };
    
    if (threadId && targetChatId === TELEGRAM_BATCH_CHAT_ID) {
      payload.message_thread_id = threadId;
    }

    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.error("فشل إرسال التليجرام:", err);
  }
}
