// api/submit-order.js (Vercel Serverless Function) - النسخة المصححة والمحمية
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL; 
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN; 
const TELEGRAM_BATCH_CHAT_ID = process.env.TELEGRAM_BATCH_CHAT_ID;      // جروب الدفعات (يحتوي على توبكس)
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;                  // قناة الطلبات الفردية

module.exports = async function handler(req, res) {
  // ترويسات CORS
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
      error: "متغيرات البيئة غير مكتملة في Vercel. يرجى التأكد من إعداد الـ 4 متغيرات." 
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
      let body = req.body;
      if (typeof body === "string") {
        body = JSON.parse(body);
      }

      if (!body || !body.actionType) {
        return res.status(400).json({ success: false, error: "بيانات الطلب غير صالحة" });
      }

      // تنظيف المدخلات وتأمينها من أخطاء الماركداون والـ undefined
      const cleanText = (str) => {
        if (!str) return "غير متوفر";
        return String(str).replace(/[_*`\[\]()]/g, "\\$&"); // تفادي الرموز الخاصة التي تعطل تليجرام
      };

      // ----------------------------------------------------
      // الحالة (أ): تأسيس دفعة جديدة (CREATE_BATCH)
      // ----------------------------------------------------
      if (body.actionType === "CREATE_BATCH") {
        const response = await fetch(GOOGLE_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const result = await response.json();

        if (result.success) {
          const newCode = result.batchCode || body.batchCode;

          // إنشاء التوبيك في تليجرام
          const threadId = await createTelegramTopic(newCode);

          // إرسال إشعار التأسيس داخل التوبيك الجديد
          const messageText = `👑 *تم تأسيس دفعة جديدة بنجاح!*\n\n` +
                              `🔑 *كود الدفعة:* \`${cleanText(newCode)}\`\n` +
                              `👤 *الممثل:* ${cleanText(body.repName)}\n` +
                              `📞 *الهاتف:* ${cleanText(body.repPhone)}\n` +
                              `🏫 *الجامعة:* ${cleanText(body.uniName)} - ${cleanText(body.collName)}\n` +
                              `🎨 *الموديل:* ${cleanText(body.batchModel)}`;
          
          await sendTelegramMessage(TELEGRAM_BATCH_CHAT_ID, messageText, threadId);

          // تحديث السكريبت في جوجل شيت بحفظ الـ threadId
          if (threadId) {
            await fetch(GOOGLE_SCRIPT_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                actionType: "UPDATE_THREAD_ID",
                batchCode: newCode,
                threadId: threadId
              }),
            });
          }
        }

        return res.status(response.status).json(result);
      }

      // ----------------------------------------------------
      // الحالة (ب): انضمام طالب لدفعة (JOIN_BATCH)
      // ----------------------------------------------------
      if (body.actionType === "JOIN_BATCH") {
        const response = await fetch(GOOGLE_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const result = await response.json();

        if (result.success) {
          const threadId = result.threadId || (result.batchData && result.batchData.threadId);

          const messageText = `🤝 *طالب جديد انضم للدفعة!*\n\n` +
                              `🔑 *كود الدفعة:* \`${cleanText(body.batchCode)}\`\n` +
                              `👤 *اسم الطالب:* ${cleanText(body.studentName)}\n` +
                              `✨ *اسم الوشاح:* ${cleanText(body.sashText)}\n` +
                              `🎨 *تفاصيل التطريز:* ${cleanText(body.sashBackText)}\n` +
                              `➕ *الإضافات:* ${cleanText(body.additions)}`;

          await sendTelegramMessage(TELEGRAM_BATCH_CHAT_ID, messageText, threadId);
        }

        return res.status(response.status).json(result);
      }

      // ----------------------------------------------------
      // الحالة (ج): طلب فردي مستقل (يدعم كافة المسميات المتوقعة)
      // ----------------------------------------------------
      if (["INDIVIDUAL_ORDER", "SINGLE_ORDER", "INDIVIDUAL", "SINGLE"].includes(body.actionType)) {
        const response = await fetch(GOOGLE_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const result = await response.json();

        if (result.success) {
          const clientName = body.studentName || body.clientName || body.name;
          const clientPhone = body.studentPhone || body.clientPhone || body.phone;

          const messageText = `🛍️ *طلب فردي جديد!*\n\n` +
                              `👤 *اسم الزبون:* ${cleanText(clientName)}\n` +
                              `📞 *الهاتف:* ${cleanText(clientPhone)}\n` +
                              `✨ *اسم الوشاح:* ${cleanText(body.sashText)}\n` +
                              `🎨 *تفاصيل التطريز:* ${cleanText(body.sashBackText)}\n` +
                              `➕ *الإضافات:* ${cleanText(body.additions)}`;

          await sendTelegramMessage(TELEGRAM_CHAT_ID, messageText);
        }

        return res.status(response.status).json(result);
      }
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
    // الحفاظ على صيغة الـ ID كنص لضمان عدم تلف الـ ID السالب الخاص بالمجموعات الخارقة
    const chatIdStr = String(TELEGRAM_BATCH_CHAT_ID).trim();

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatIdStr,
        name: String(name)
      })
    });
    
    const data = await response.json();
    if (data.ok && data.result) {
      return data.result.message_thread_id; 
    }
    console.error("فشل تليجرام في إنشاء التوبيك. السبب:", data.description);
    return null;
  } catch (err) {
    console.error("خطأ برمي أثناء إنشاء التوبك:", err);
    return null;
  }
}

// دالة إرسال الرسائل العامة
async function sendTelegramMessage(targetChatId, text, threadId = null) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const chatIdStr = String(targetChatId).trim();

    const payload = {
      chat_id: chatIdStr,
      text: text,
      parse_mode: "Markdown"
    };
    
    // إرفاق التوبيك بشكل سليم إذا توفر
    if (threadId) {
      payload.message_thread_id = Number(threadId);
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    
    const result = await res.json();
    if (!result.ok) {
      console.error(`فشل الإرسال لـ ${chatIdStr}. السبب:`, result.description);
    }
  } catch (err) {
    console.error("فشل إرسال التليجرام تماماً:", err);
  }
}
