// api/submit-order.js (Vercel Serverless Function) - النسخة الاحترافية الكاملة
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL; 
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN; 
const TELEGRAM_BATCH_CHAT_ID = process.env.TELEGRAM_BATCH_CHAT_ID;      // جروب الدفعات (الذي يحتوي على توبكس)
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

      // ----------------------------------------------------
      // الحالة (أ): تأسيس دفعة جديدة (CREATE_BATCH)
      // ----------------------------------------------------
      if (body.actionType === "CREATE_BATCH") {
        // 1. نرسل أولاً لجوجل شيت لإنشاء الدفعة وتوليد الكود التسلسلي (مثلاً Ali1)
        const response = await fetch(GOOGLE_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const result = await response.json();

        if (result.success) {
          const newCode = result.batchCode;

          // 2. ننشئ التوبيك في تليجرام باسم كود الدفعة الجديد
          const threadId = await createTelegramTopic(newCode);

          // 3. نرسل إشعار التأسيس داخل هذا التوبيك الجديد
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

          // 4. خطوة ذكية: نحدث السكريبت في جوجل شيت بحفظ الـ threadId الخاص بالدفعة للرجوع له عند انضمام الطلاب
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

        return res.status(response.status).json(result);
      }

      // ----------------------------------------------------
      // الحالة (ب): انضمام طالب لدفعة (JOIN_BATCH)
      // ----------------------------------------------------
      if (body.actionType === "JOIN_BATCH") {
        // نرسل البيانات لجوجل شيت لتسجيل الطالب
        const response = await fetch(GOOGLE_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const result = await response.json();

        if (result.success) {
          // جلب الـ threadId الذي حفظناه سابقاً للدفعة من جوجل شيت (يرجعه السكريبت في الـ result)
          const threadId = result.threadId || (result.batchData && result.batchData.threadId);

          // إرسال الإشعار داخل التوبيك المخصص لهذه الدفعة في جروب الدفعات
          await sendTelegramMessage(
            TELEGRAM_BATCH_CHAT_ID,
            `🤝 *طالب جديد انضم للدفعة!*\n\n` +
            `🔑 *كود الدفعة:* \`${body.batchCode}\`\n` +
            `👤 *اسم الطالب:* ${body.studentName}\n` +
            `✨ *اسم الوشاح:* ${body.sashText}\n` +
            `🎨 *تفاصيل التطريز:* ${body.sashBackText || "لا يوجد"}\n` +
            `➕ *الإضافات:* ${body.additions || "لا توجد"}`,
            threadId
          );
        }

        return res.status(response.status).json(result);
      }

      // ----------------------------------------------------
      // الحالة (ج): طلب فردي مستقل (INDIVIDUAL_ORDER)
      // ----------------------------------------------------
      if (body.actionType === "INDIVIDUAL_ORDER" || body.actionType === "SINGLE_ORDER") {
        const response = await fetch(GOOGLE_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const result = await response.json();

        if (result.success) {
          // إرسال الإشعار فوراً ومباشرة لقناة الطلب الفردي الخاصة
          await sendTelegramMessage(
            TELEGRAM_CHAT_ID,
            `🛍️ *طلب فردي جديد!*\n\n` +
            `👤 *اسم الزبون:* ${body.studentName || body.clientName}\n` +
            `📞 *الهاتف:* ${body.studentPhone || body.clientPhone || "غير متوفر"}\n` +
            `✨ *اسم الوشاح:* ${body.sashText}\n` +
            `🎨 *تفاصيل التطريز:* ${body.sashBackText || "لا يوجد"}\n` +
            `➕ *الإضافات:* ${body.additions || "لا توجد"}`
          );
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
    const numericChatId = isNaN(TELEGRAM_BATCH_CHAT_ID) ? TELEGRAM_BATCH_CHAT_ID : Number(TELEGRAM_BATCH_CHAT_ID);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: numericChatId,
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
    const chatValue = isNaN(targetChatId) ? targetChatId : Number(targetChatId);

    const payload = {
      chat_id: chatValue,
      text: text,
      parse_mode: "Markdown"
    };
    
    // إرسال داخل التوبك إذا تم تمرير الـ threadId
    if (threadId && Number(targetChatId) === Number(TELEGRAM_BATCH_CHAT_ID)) {
      payload.message_thread_id = Number(threadId);
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    
    const result = await res.json();
    if (!result.ok) {
      console.error("تليجرام رفض إرسال الرسالة. السبب:", result.description);
    }
  } catch (err) {
    console.error("فشل إرسال التليجرام:", err);
  }
}
