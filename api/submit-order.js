// api/submit-order.js (إصدار المزامنة الرقمية التامة وفصل الصفحات)
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL; 
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN; 
const TELEGRAM_BATCH_CHAT_ID = process.env.TELEGRAM_BATCH_CHAT_ID; 
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID; 

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    if (req.method === "GET") {
      const { actionType, batchCode } = req.query;
      if (actionType === "VERIFY_BATCH") {
        const targetUrl = `${GOOGLE_SCRIPT_URL}?actionType=VERIFY_BATCH&batchCode=${encodeURIComponent(batchCode)}`;
        const response = await fetch(targetUrl, { method: "GET" });
        const result = await response.json();
        return res.status(response.status).json(result);
      }
    }

    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") body = JSON.parse(body);

      const cleanText = (str) => {
        if (!str) return "غير متوفر";
        return String(str).replace(/[_*`\[\]()]/g, "\\$&");
      };

      // ----------------------------------------------------
      // الحالة أ: تأسيس دفعة جديدة (CREATE_BATCH)
      // ----------------------------------------------------
      if (body.actionType === "CREATE_BATCH") {
        const topicName = `${body.uniName || 'دفعة'} - ${body.repName || 'جديدة'}`;
        const threadId = await createTelegramTopic(topicName);

        if (!threadId) {
          return res.status(500).json({ success: false, error: "فشل إنشاء توبك التليجرام" });
        }

        // تثبيت الكود ليكون هو الـ Thread ID في الشيت والتليجرام والفرونت إند بدون أي تباين
        const finalNumericCode = String(threadId);
        body.batchCode = finalNumericCode;
        body.threadId = finalNumericCode;

        // الحفظ في جوجل شيت
        const response = await fetch(GOOGLE_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const result = await response.json();

        // إرسال الإشعار للتليجرام
        const messageText = `👑 *تم تأسيس دفعة جديدة بنجاح!*\n\n` +
                            `🔢 *كود الدفعة الموحد:* \`${finalNumericCode}\`\n` +
                            `👤 *الممثل:* ${cleanText(body.repName)}\n` +
                            `📞 *الهاتف:* ${cleanText(body.repPhone)}\n` +
                            `🏫 *الجامعة:* ${cleanText(body.uniName)} - ${cleanText(body.collName)}\n` +
                            `🎨 *الموديل:* ${cleanText(body.batchModel)}`;
        
        await sendTelegramMessage(TELEGRAM_BATCH_CHAT_ID, messageText, threadId);
        await updateTelegramTopicName(threadId, `دفعة رقم: ${finalNumericCode}`);

        result.batchCode = finalNumericCode;
        return res.status(response.status).json(result);
      }

      // ----------------------------------------------------
      // الحالة ب: انضمام طالب لدفعة (JOIN_BATCH)
      // ----------------------------------------------------
      if (body.actionType === "JOIN_BATCH") {
        const response = await fetch(GOOGLE_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const result = await response.json();

        if (result.success) {
          const threadId = Number(body.batchCode);

          const messageText = `🤝 *طالب جديد انضم للدفعة!*\n\n` +
                              `🔢 *كود الدفعة:* \`${cleanText(body.batchCode)}\`\n` +
                              `👤 *اسم الطالب:* ${cleanText(body.studentName)}\n` +
                              `✨ *اسم الوشاح:* ${cleanText(body.sashText)}\n` +
                              `🎨 *تفاصيل التطريز:* ${cleanText(body.sashBackText || "لا يوجد")}\n` +
                              `➕ *الإضافات:* ${cleanText(body.additions)}`;

          await sendTelegramMessage(TELEGRAM_BATCH_CHAT_ID, messageText, threadId);

          if (body.images) {
            const labels = {
              sashFixedImg: "صورة الطرف الثابت للوشاح",
              sashBackImg: "صورة ظهر الوشاح",
              capTopImg: "صورة أعلى القبعة",
              capSideImg: "صورة جانب القبعة"
            };
            for (const [key, imgObj] of Object.entries(body.images)) {
              if (imgObj && imgObj.base64) {
                const caption = `📸 ${labels[key] || "صورة مرفقة"} للجلوس: ${body.studentName}`;
                await sendTelegramPhoto(TELEGRAM_BATCH_CHAT_ID, imgObj.base64, caption, threadId);
              }
            }
          }
        }
        return res.status(response.status).json(result);
      }

      // ----------------------------------------------------
      // الحالة ج: طلب فردي مستقل (INDIVIDUAL_ORDER)
      // ----------------------------------------------------
      if (["INDIVIDUAL_ORDER", "SINGLE_ORDER"].includes(body.actionType)) {
        const response = await fetch(GOOGLE_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const result = await response.json();

        if (result.success) {
          const clientName = body.studentName || body.clientName || "غير محدد";
          const clientPhone = body.phone || body.studentPhone || body.clientPhone || "غير متوفر";
          
          const messageText = `🛍️ *طلب فردي جديد!*\n\n` +
                              `👤 *اسم الزبون:* ${cleanText(clientName)}\n` +
                              `📞 *الهاتف:* ${cleanText(clientPhone)}\n` +
                              `✨ *اسم الوشاح:* ${cleanText(body.sashText)}\n` +
                              `🎨 *الموديل والقماش:* ${cleanText(body.batchModel)} - ${cleanText(body.batchFabric)}\n` +
                              `➕ *الإضافات المخصصة:* ${cleanText(body.additions)}`;

          await sendTelegramMessage(TELEGRAM_CHAT_ID, messageText);

          if (body.images) {
            const labels = {
              sashFixedImg: "صورة الطرف الثابت للوشاح",
              sashBackImg: "صورة ظهر الوشاح",
              capTopImg: "صورة أعلى القبعة",
              capSideImg: "صورة جانب القبعة"
            };
            for (const [key, imgObj] of Object.entries(body.images)) {
              if (imgObj && imgObj.base64) {
                const caption = `📸 ${labels[key] || "صورة مرفقة"} للزبون: ${clientName}`;
                await sendTelegramPhoto(TELEGRAM_CHAT_ID, imgObj.base64, caption);
              }
            }
          }
        }
        return res.status(response.status).json(result);
      }
    }
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

async function createTelegramTopic(name) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/createForumTopic`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: String(TELEGRAM_BATCH_CHAT_ID).trim(), name: String(name) })
    });
    const data = await response.json();
    return data.ok && data.result ? data.result.message_thread_id : null;
  } catch (err) { return null; }
}

async function updateTelegramTopicName(threadId, newName) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editForumTopic`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: String(TELEGRAM_BATCH_CHAT_ID).trim(), message_thread_id: Number(threadId), name: newName })
    });
  } catch (err) {}
}

async function sendTelegramMessage(targetChatId, text, threadId = null) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const payload = { chat_id: String(targetChatId).trim(), text: text, parse_mode: "Markdown" };
    if (threadId) payload.message_thread_id = Number(threadId);
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  } catch (err) {}
}

async function sendTelegramPhoto(targetChatId, base64Data, caption, threadId = null) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
    const buffer = Buffer.from(base64Data, 'base64');
    const formData = new FormData();
    formData.append('chat_id', String(targetChatId).trim());
    formData.append('caption', caption);
    if (threadId) formData.append('message_thread_id', String(threadId));
    const blob = new Blob([buffer], { type: 'image/jpeg' });
    formData.append('photo', blob, 'design.jpg');
    await fetch(url, { method: "POST", body: formData });
  } catch (err) {}
}
