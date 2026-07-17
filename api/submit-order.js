// api/submit-order.js (الإصدار الشامل والمصحح 100%)
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
    // ----------------------------------------------------
    // جلب البيانات والتحقق (GET - VERIFY_BATCH)
    // ----------------------------------------------------
    if (req.method === "GET") {
      const { actionType, batchCode } = req.query;
      if (actionType === "VERIFY_BATCH") {
        const cleanCode = String(batchCode || "").trim();
        const response = await fetch(`${GOOGLE_SCRIPT_URL}?actionType=VERIFY_BATCH&batchCode=${encodeURIComponent(cleanCode)}`);
        const result = await response.json();
        return res.status(200).json(result);
      }
    }

    // ----------------------------------------------------
    // معالجة الإرسال (POST)
    // ----------------------------------------------------
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
            if (item.base64 && typeof item.base64 === 'string') list.push(item.base64);
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

        const finalNumericCode = String(threadId).trim();
        
        // 🚀 بناء كائن نظيف تماماً لإرساله إلى Google Sheet لمنع التداخل
        const cleanPayload = {
          actionType: "CREATE_BATCH",
          batchCode: finalNumericCode,
          threadId: finalNumericCode,
          repName: body.repName || body.name || "",
          repPhone: body.repPhone || body.phone || "",
          uniName: body.uniName || body.university || "",
          collName: body.collName || body.college || "",
          deptName: body.deptName || body.department || "",
          studentCount: body.studentCount || body.count || "0",
          // إجبار الموديل والقماش على أسماء صريحة وثابتة
          batchModel: body.batchModel || body.model || body.selectedModel || "غير محدد",
          batchFabric: body.batchFabric || body.fabric || body.selectedFabric || "غير محدد",
          base64: extractedImages.length > 0 ? extractedImages[0] : null
        };

        // إرسال البيانات فوراً إلى جوجل شيت
        const response = await fetch(GOOGLE_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cleanPayload),
        });
        
        // إرسال التقرير النصي للتليجرام
        const messageText = `👑 *تم تأسيس دفعة جديدة بنجاح!*\n\n` +
                            `🔢 *كود الدفعة الموحد:* \`${finalNumericCode}\`\n` +
                            `👤 *الممثل:* ${cleanText(cleanPayload.repName)}\n` +
                            `📞 *الهاتف:* ${cleanText(cleanPayload.repPhone)}\n` +
                            `🏫 *الجامعة:* ${cleanText(cleanPayload.uniName)} - ${cleanText(cleanPayload.collName)}\n` +
                            `🎨 *الموديل المعتمد:* ${cleanText(cleanPayload.batchModel)}\n` +
                            `🧵 *القماش:* ${cleanText(cleanPayload.batchFabric)}`;
        
        await sendTelegramMessage(TELEGRAM_BATCH_CHAT_ID, messageText, threadId);
        await updateTelegramTopicName(threadId, `دفعة رقم: ${finalNumericCode}`);

        // إذا تم العثور على صورة (شعار الجامعة)، يتم إرسالها فوراً للتوبك
        if (extractedImages.length > 0) {
          await sendTelegramPhoto(TELEGRAM_BATCH_CHAT_ID, extractedImages[0], `📸 شعار الجامعة الرسمي لدفعة رقم: ${finalNumericCode}`, threadId);
        }

        return res.status(200).json({ success: true, batchCode: finalNumericCode });
      }

      // ----------------------------------------------------
      // الحالة ب: انضمام طالب لدفعة (JOIN_BATCH)
      // ----------------------------------------------------
      if (body.actionType === "JOIN_BATCH") {
        const currentBatchCode = String(body.batchCode || body.threadId || "").trim();
        
        // 🚀 تنظيف كائن الانضمام قبل إرساله للشيت
        const cleanPayload = {
          actionType: "JOIN_BATCH",
          batchCode: currentBatchCode,
          threadId: currentBatchCode,
          studentName: body.studentName || body.name || "",
          sashText: body.sashText || "",
          sashBack: body.sashBack || body.sashBackText || "",
          capTop: body.capTop || "",
          capSide: body.capSide || "",
          additions: body.additions || "",
          base64: extractedImages.length > 0 ? extractedImages[0] : null,
          images: extractedImages // إرسال كافة الصور للشيت إن أمكن
        };

        const response = await fetch(GOOGLE_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cleanPayload),
        });
        const result = await response.json();

        if (result.success) {
          const threadId = Number(currentBatchCode);
          const sName = cleanPayload.studentName || "طالب جديد";

          const messageText = `🤝 *طالب جديد انضم للدفعة:* ${cleanText(sName)}\n` +
                              `🔢 *كود الدفعة المسجل:* \`${currentBatchCode}\`\n` +
                              `✨ *التطريز:* ${cleanText(cleanPayload.sashText)}\n` +
                              `🎨 *الظهر:* ${cleanText(cleanPayload.sashBack || "لا يوجد")}\n` +
                              `➕ *الإضافات:* ${cleanText(cleanPayload.additions)}`;

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

          for (let k = 0; k < extractedImages.length; k++) {
            await sendTelegramPhoto(TELEGRAM_CHAT_ID, extractedImages[k], `📸 صورة طلب فردي للزبون: ${clientName}`);
          }
        }
        return res.status(200).json(result);
      }
    }
  } catch (error) {
    console.error("Handler Error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================================================
// الدوال المساعدة للتليجرام
// ============================================================================
async function createTelegramTopic(name) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/createForumTopic`;
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: String(TELEGRAM_BATCH_CHAT_ID).trim(), name: String(name) }) });
    const data = await response.json(); 
    return data.ok && data.result ? data.result.message_thread_id : null;
  } catch (err) { return null; }
}

async function updateTelegramTopicName(threadId, newName) {
  try { 
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editForumTopic`; 
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: String(TELEGRAM_BATCH_CHAT_ID).trim(), message_thread_id: Number(threadId), name: newName }) }); 
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
    if (base64Data.includes(",")) base64Data = base64Data.split(",")[1];
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
    const buffer = Buffer.from(base64Data, 'base64');
    
    // استخدام FormData المتوافق مع Node.js الحديث
    const formData = new FormData();
    formData.append('chat_id', String(targetChatId).trim());
    formData.append('caption', caption);
    if (threadId) formData.append('message_thread_id', String(threadId));
    
    const blob = new Blob([buffer], { type: 'image/jpeg' });
    formData.append('photo', blob, 'image.jpg');
    
    await fetch(url, { method: "POST", body: formData });
  } catch (err) {
    console.error("Telegram Photo Error:", err);
  }
}
