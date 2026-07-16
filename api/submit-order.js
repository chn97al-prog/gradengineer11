// api/submit-order.js (Vercel Serverless Function) - مجاني 100% وبدون KV
export const config = {
  maxDuration: 60, // زيادة وقت الانتظار لضمان عدم تعليق السيرفر
};

// قراءة الإعدادات والروابط بأمان من الـ Environment Variables في فيرسيل
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL; 
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN; 
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;      // آيدي جروب الدفعات (توبكس)
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;  // آيدي قناة الفردي الخاصة بالطلاب

export default async function handler(req, res) {
  // ترويسات CORS للسماح بالوصول الآمن من موقعك
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  // التحقق من أنك أضفت المتغيرات الأربعة في لوحة تحكم فيرسيل
  if (!GOOGLE_SCRIPT_URL || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !TELEGRAM_CHANNEL_ID) {
    return res.status(500).json({ 
      success: false, 
      error: "يرجى التأكد من إضافة المتغيرات الأربعة (GOOGLE_SCRIPT_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_CHANNEL_ID) في إعدادات Vercel." 
    });
  }

  try {
    // 1. عملية فحص الكود (GET) - تتم مباشرة عبر الاستعلام من جوجل شيت
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
      const body = req.body;

      // إرسال البيانات لجوجل شيت لحفظها وتوليد الكود التسلسلي المميز للممثل
      const response = await fetch(GOOGLE_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const result = await response.json();

      if (result.success) {
        // حالة (أ): تأسيس دفعة جديدة -> إنشاء توبك وإرسال الإشعار لجروب الدفعات
        if (body.actionType === "CREATE_BATCH") {
          const newCode = result.batchCode;
          
          // إنشاء التوبك تلقائياً في التليجرام باسم الكود الجديد (مثال: Ali1)
          const threadId = await createTelegramTopic(newCode);
          
          // إرسال تفاصيل الدفعة داخل التوبك الذي تم إنشاؤه للتو
          await sendTelegramMessage(
            TELEGRAM_CHAT_ID,
            `👑 *تم تأسيس دفعة جديدة بنجاح!*\n\n` +
            `🔑 *كود الدفعة:* \`${newCode}\`\n` +
            `👤 *الممثل (الكامل):* ${body.repName}\n` +
            `📞 *الهاتف:* ${body.repPhone}\n` +
            `🏫 *الجامعة:* ${body.uniName} - ${body.collName}\n` +
            `🎨 *الموديل:* ${body.batchModel}`,
            threadId
          );
        }

        // حالة (ب): انضمام طالب جديد -> يرسل الإشعار مباشرة لقناة الفردي الخاصة
        if (body.actionType === "JOIN_BATCH") {
          const batchCode = body.batchCode;

          await sendTelegramMessage(
            TELEGRAM_CHANNEL_ID,
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

    return res.status(405).json({ success: false, error: "الطريقة غير مسموح بها" });

  } catch (error) {
    console.error("Vercel Function Error:", error);
    return res.status(500).json({ success: false, error: "حدث خطأ في الاتصال بالسيرفر: " + error.message });
  }
}

// دالة لإنشاء Topic (موضوع) جديد في جروب الدفعات بالتليجرام
async function createTelegramTopic(name) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/createForumTopic`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        name: name 
      })
    });
    const data = await response.json();
    if (data.ok) {
      return data.result.message_thread_id; // إرجاع آيدي التوبك المولد تلقائياً
    }
    return null;
  } catch (err) {
    console.error("خطأ في إنشاء التوبك:", err);
    return null;
  }
}

// دالة إرسال الرسائل العامة (تدعم التوجيه داخل التوبكس للجروبات)
async function sendTelegramMessage(targetChatId, text, threadId = null) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const payload = {
      chat_id: targetChatId,
      text: text,
      parse_mode: "Markdown"
    };
    
    // إذا كانت الوجهة هي جروب الدفعات الرئيسي وهناك توبك محدد، أرسلها داخله
    if (threadId && targetChatId === TELEGRAM_CHAT_ID) {
      payload.message_thread_id = threadId;
    }

    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.error("خطأ في إرسال رسالة التليجرام:", err);
  }
}
