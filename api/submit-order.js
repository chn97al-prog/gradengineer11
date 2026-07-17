// api/submit-order.js (الإصدار الفاحص والجامع الشامل للصور والأكواد الموحدة)
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
        const response = await fetch(`${GOOGLE_SCRIPT_URL}?actionType=VERIFY_BATCH&batchCode=${encodeURIComponent(batchCode)}`);
        const result = await response.json();
        return res.status(200).json(result);
      }
    }

    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") body = JSON.parse(body);

      const cleanText = (str) => (!str ? "غير متوفر" : String(str).replace(/[_*`\[\]()]/g, "\\$&"));
      
      // دالة لاستخراج كل نصوص Base64 من الـ body بشكل ديناميكي
      const getAllBase64s = (obj) => {
        let list = [];
        const extract = (item) => {
          if (!item) return;
          if (typeof item === 'string' && (item.length > 500 || item.includes('base64'))) {
            list.push(item);
          } else if (typeof item === 'object') {
            if (item.base64) list.push(item.base64);
            else { for (let k in item) extract(item[k]); }
          }
        };
        extract(obj);
        return list;
      };

      const extractedImages = getAllBase64s(body);

      // ----------------------------------------------------
      // الحالة أ: تأسيس دفعة جديدة (CREATE_BATCH)
      // ----------------------------------------------------
      if (body.actionType === "CREATE_BATCH") {
        const topicName = `${body.uniName || 'دفعة جديدة'} - ${body.repName || ''}`;
        const threadId = await createTelegramTopic(topicName);

        if (!threadId) return res.status(500).json({ success: false, error: "فشل تليجرام في إنشاء التوبك" });

        const finalNumericCode = String(threadId);
        body.batchCode = finalNumericCode;
        body.threadId = finalNumericCode;

        // إرسال البيانات فوراً إلى جوجل شيت
        const response = await fetch(GOOGLE_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        
        // إرسال التقرير النصي للتليجرام
        const messageText = `👑 *تم تأسيس دفعة جديدة بنجاح!*\n\n` +
                            `🔢 *كود الدفعة الموحد:* \`${finalNumericCode}\`\n` +
                            `👤 *الممثل:* ${cleanText(body.repName || body.name)}\n` +
                            `📞 *الهاتف:* ${cleanText(body.repPhone || body.phone)}\n` +
                            `🏫 *الجامعة:* ${cleanText(body.uniName)} - ${cleanText(body.collName)}\n` +
                            `🎨 *الموديل المعتمد:* ${cleanText(body.batchModel || body.model)}`;
        
        await sendTelegramMessage(TELEGRAM_BATCH_CHAT_ID, messageText, threadId);
        await updateTelegramTopicName(threadId, `دفعة رقم: ${finalNumericCode}`);

        // إذا تم العثور على أي صورة (شعار الجامعة)، يتم إرسالها فوراً للتوبك
        if (extractedImages.length > 0) {
          await sendTelegramPhoto(TELEGRAM_BATCH_CHAT_ID, extractedImages[0], `📸 شعار الجامعة الرسمي لدفعة رقم: ${finalNumericCode}`, threadId);
        }

        // إرجاع رد صارم للفرونت إند يحمل الكود النهائي لمنع أي التباس
        return res.status(200).json({ success: true, batchCode: finalNumericCode });
      }

      // ----------------------------------------------------
      // الحالة ب: انضمام طالب لدفعة (JOIN_BATCH)
      // ----------------------------------------------------
      if (body.actionType === "JOIN_BATCH") {
        const currentBatchCode = String(body.batchCode || body.threadId).trim();
        body.batchCode = currentBatchCode; // توحيد الحقل المرسل للشيت

        const response = await fetch(GOOGLE_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const result = await response.json();

        if (result.success) {
          const threadId = Number(currentBatchCode);
          const sName = body.studentName || body.name || "طالب جديد";

          const messageText = `🤝 *طالب جديد انضم للدفعة:* ${cleanText(sName)}\n` +
                              `🔢 *كود الدفعة المسجل:* \`${currentBatchCode}\`\n` +
                              `✨ *التطريز:* ${cleanText(body.sashText)}\n` +
                              `🎨 *الظهر:* ${cleanText(body.sashBackText || "لا يوجد")}\n` +
                              `➕ *الإضافات:* ${cleanText(body.additions)}`;

          await sendTelegramMessage(TELEGRAM_BATCH_CHAT_ID, messageText, threadId);

          // إرسال كافة الصور المكتشفة تباعاً للتليجرام
          for (let i = 0; i < extractedImages.length; i++) {
            await sendTelegramPhoto(TELEGRAM_BATCH_CHAT_ID, extractedImages[i], `📸 صورة مرفقة رقم (${i+1}) للطالب: ${sName}`, threadId);
          }
        }
        return res.status(200).json(result);
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
          const clientName = body.studentName || body.clientName || body.name || "زبون مجهول";
          const messageText = `🛍️ *طلب فردي جديد!*\n\n` +
                              `👤 *الزبون:* ${cleanText(clientName)}\n` +
                              `📞 *الهاتف:* ${cleanText(body.phone || body.clientPhone)}\n` +
                              `✨ *اسم الوشاح:* ${cleanText(body.sashText)}`;

          await sendTelegramMessage(TELEGRAM_CHAT_ID, messageText);

          for (let k = 0; i < extractedImages.length; k++) {
            await sendTelegramPhoto(TELEGRAM_CHAT_ID, extractedImages[k], `📸 صورة طلب فردي للزبون: ${clientName}`);
          }
        }
        return res.status(200).json(result);
      }
    }
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// الدوال المساعدة للتليجرام (تبقى ثابتة ومستقرة)
async function createTelegramTopic(name) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/createForumTopic`;
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: String(TELEGRAM_BATCH_CHAT_ID).trim(), name: String(name) }) });
    const data = await response.json(); return data.ok && data.result ? data.result.message_thread_id : null;
  } catch (err) { return null; }
}
async function updateTelegramTopicName(threadId, newName) {
  try { const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editForumTopic`; await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: String(TELEGRAM_BATCH_CHAT_ID).trim(), message_thread_id: Number(threadId), name: newName }) }); } catch (err) {}
}
async function sendTelegramMessage(targetChatId, text, threadId = null) {
  try { const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`; const payload = { chat_id: String(targetChatId).trim(), text: text, parse_mode: "Markdown" }; if (threadId) payload.message_thread_id = Number(threadId); await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); } catch (err) {}
}
async function sendTelegramPhoto(targetChatId, base64Data, caption, threadId = null) {
  try {
    if (base64Data.includes(",")) base64Data = base64Data.split(",")[1];
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
    const buffer = Buffer.from(base64Data, 'base64');
    const formData = new FormData();
    formData.append('chat_id', String(targetChatId).trim());
    formData.append('caption', caption);
    if (threadId) formData.append('message_thread_id', String(threadId));
    const blob = new Blob([buffer], { type: 'image/jpeg' });
    formData.append('photo', blob, 'image.jpg');
    await fetch(url, { method: "POST", body: formData });
  } catch (err) {}
}
