// api/submit-order.js
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
        const cleanCode = String(batchCode || "").trim();
        const response = await fetch(`${GOOGLE_SCRIPT_URL}?actionType=VERIFY_BATCH&batchCode=${encodeURIComponent(cleanCode)}`);
        const result = await response.json();
        return res.status(200).json(result);
      }
    }

    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") body = JSON.parse(body);

      const cleanText = (str) => (!str ? "غير متوفر" : String(str).replace(/[_*`\[\]()]/g, "\\$&"));

      // 🎯 دالة تنظيم الصور المرفوعة حسب المكان
      const prepareImagesObject = (rawImages) => {
        let formatted = {};
        if (!rawImages || typeof rawImages !== 'object') return formatted;

        const keys = ['sashFixedImg', 'sashBackImg', 'capTopImg', 'capSideImg'];
        keys.forEach(k => {
          if (rawImages[k]) {
            formatted[k] = typeof rawImages[k] === 'object' ? rawImages[k].base64 : rawImages[k];
          }
        });
        return formatted;
      };

      const imagesObj = prepareImagesObject(body.images);

      // ----------------------------------------------------
      // الحالة أ: تأسيس دفعة جديدة (CREATE_BATCH)
      // ----------------------------------------------------
      if (body.actionType === "CREATE_BATCH") {
        const topicName = `${body.uniName || 'دفعة جديدة'} - ${body.repName || ''}`;
        const threadId = await createTelegramTopic(topicName);

        if (!threadId) return res.status(500).json({ success: false, error: "فشل إنشاء التوبك في تليجرام" });

        // نستخدم كود الدفعة المرسل من الموقع إن وجد، وإلا نعتمد رقم التوبك
        const finalBatchCode = String(body.batchCode || body.code || threadId).trim();

        const cleanPayload = {
          actionType: "CREATE_BATCH",
          batchCode: finalBatchCode,
          threadId: threadId,
          repName: body.repName || body.name || "",
          repPhone: body.repPhone || body.phone || "",
          uniName: body.uniName || body.university || "",
          collName: body.collName || body.college || "",
          deptName: body.deptName || body.department || "",
          studentCount: body.studentCount || body.count || "0",
          batchModel: body.batchModel || body.model || "غير محدد",
          batchFabric: body.batchFabric || body.fabric || "غير محدد",
          images: imagesObj
        };

        try {
          await fetch(GOOGLE_SCRIPT_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(cleanPayload),
          });
        } catch (e) { console.error("Sheet Error:", e); }

        const messageText = `👑 *تم تأسيس دفعة جديدة بنجاح!*\n\n` +
                            `🔢 *كود الدفعة:* \`${finalBatchCode}\`\n` +
                            `👤 *الممثل:* ${cleanText(cleanPayload.repName)}\n` +
                            `📞 *الهاتف:* ${cleanText(cleanPayload.repPhone)}\n` +
                            `🏫 *الجامعة:* ${cleanText(cleanPayload.uniName)} - ${cleanText(cleanPayload.collName)}\n` +
                            `🎨 *الموديل المعتمد:* ${cleanText(cleanPayload.batchModel)}\n` +
                            `🧵 *القماش:* ${cleanText(cleanPayload.batchFabric)}`;

        await sendTelegramMessage(TELEGRAM_BATCH_CHAT_ID, messageText, threadId);

        return res.status(200).json({ success: true, batchCode: finalBatchCode, code: finalBatchCode });
      }

      // ----------------------------------------------------
      // الحالة ب: انضمام طالب لدفعة (JOIN_BATCH)
      // ----------------------------------------------------
      if (body.actionType === "JOIN_BATCH") {
        const currentBatchCode = String(body.batchCode || body.threadId || "").trim();

        const cleanPayload = {
          actionType: "JOIN_BATCH",
          batchCode: currentBatchCode,
          studentName: body.studentName || body.name || "",
          sashText: body.sashText || "",
          sashFixedText: body.sashFixedText || "",
          sashBackText: body.sashBackText || body.sashBack || "",
          capTopText: body.capTopText || body.capTop || "",
          capSideText: body.capSideText || body.capSide || "",
          additions: body.additions || "",
          images: imagesObj
        };

        try {
          await fetch(GOOGLE_SCRIPT_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(cleanPayload),
          });
        } catch (e) { console.error("Sheet Error:", e); }

        const threadId = Number(currentBatchCode);
        const sName = cleanPayload.studentName || "طالب جديد";

        const messageText = `🤝 *طالب جديد انضم للدفعة:* ${cleanText(sName)}\n` +
                            `🔢 *كود الدفعة:* \`${currentBatchCode}\`\n` +
                            `✨ *التطريز:* ${cleanText(cleanPayload.sashText)}\n` +
                            `📌 *الطرف الثابت:* ${cleanText(cleanPayload.sashFixedText || "لا يوجد")}\n` +
                            `🎨 *الظهر:* ${cleanText(cleanPayload.sashBackText || "لا يوجد")}\n` +
                            `➕ *الإضافات:* ${cleanText(cleanPayload.additions)}`;

        await sendTelegramMessage(TELEGRAM_BATCH_CHAT_ID, messageText, threadId);

        const labelMap = { sashFixedImg: 'صورة الطرف الثابت', sashBackImg: 'صورة ظهر الوشاح', capTopImg: 'صورة فوق القبعة', capSideImg: 'صورة جانب القبعة' };
        for (const [k, imgBase64] of Object.entries(imagesObj)) {
          if (imgBase64) {
            await sendTelegramPhoto(TELEGRAM_BATCH_CHAT_ID, imgBase64, `📸 [${labelMap[k] || 'صورة'}] للطالب: ${sName}`, threadId);
          }
        }

        return res.status(200).json({ success: true });
      }

      // ----------------------------------------------------
      // الحالة ج: طلب فردي كامل (SINGLE_ORDER)
      // ----------------------------------------------------
      if (["SINGLE_ORDER", "INDIVIDUAL_ORDER"].includes(body.actionType)) {
        const studentName = body.studentName || "طالب مجهول";
        
        const cleanPayload = {
          actionType: "SINGLE_ORDER",
          studentName: studentName,
          phone: body.phone || "غير متوفر",
          batchModel: body.batchModel || "غير محدد",
          batchFabric: body.batchFabric || "غير محدد",
          sashSelected: body.sashSelected || "لا ينطبق",
          lengthGown: body.lengthGown || "0",
          lengthSleeve: body.lengthSleeve || "0",
          shoulder: body.shoulder || "0",
          chest: body.chest || "0",
          head: body.head || "0",
          sashText: body.sashText || "",
          sashFixedText: body.sashFixedText || "لم يكتب شيء",
          sashBackText: body.sashBackText || "لم يكتب شيء",
          capTopText: body.capTopText || "لم يكتب شيء",
          capSideText: body.capSideText || "لم يكتب شيء",
          additions: body.additions || "لا توجد إضافات",
          images: imagesObj
        };

        try {
          await fetch(GOOGLE_SCRIPT_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(cleanPayload),
          });
        } catch (e) { console.error("Sheet Error:", e); }

        const messageText = `🛍️ *طلب فردي جديد بالكامل!*
----------------------------------
👤 *اسم الطالب:* ${cleanText(studentName)}
📞 *رقم الهاتف:* ${cleanText(cleanPayload.phone)}

🎨 *الموديل:* ${cleanText(cleanPayload.batchModel)}
🧵 *نوع القماش:* ${cleanText(cleanPayload.batchFabric)}
🎗️ *قصة الوشاح:* ${cleanText(cleanPayload.sashSelected)}
----------------------------------
📏 *القياسات الدقيقة (سم):*
• طول الروب: \`${cleanText(cleanPayload.lengthGown)}\` سم
• طول الردن: \`${cleanText(cleanPayload.lengthSleeve)}\` سم
• الكتف: \`${cleanText(cleanPayload.shoulder)}\` سم
• محيط الصدر: \`${cleanText(cleanPayload.chest)}\` سم
• قياس الرأس: \`${cleanText(cleanPayload.head)}\` سم
----------------------------------
✍️ *تفاصيل التطريز:*
✨ *اسم الوشاح:* ${cleanText(cleanPayload.sashText)}
📌 *الطرف الثابت:* ${cleanText(cleanPayload.sashFixedText)}
🔙 *ظهر الوشاح:* ${cleanText(cleanPayload.sashBackText)}
🎩 *فوق القبعة:* ${cleanText(cleanPayload.capTopText)}
🧢 *جانب القبعة:* ${cleanText(cleanPayload.capSideText)}

➕ *الإضافات:* ${cleanText(cleanPayload.additions)}`;

        await sendTelegramMessage(TELEGRAM_CHAT_ID, messageText);

        const labelMap = { sashFixedImg: 'صورة الطرف الثابت', sashBackImg: 'صورة ظهر الوشاح', capTopImg: 'صورة فوق القبعة', capSideImg: 'صورة جانب القبعة' };
        for (const [k, imgBase64] of Object.entries(imagesObj)) {
          if (imgBase64) {
            await sendTelegramPhoto(TELEGRAM_CHAT_ID, imgBase64, `📸 [${labelMap[k] || 'صورة'}] للطالب: ${studentName}`);
          }
        }

        return res.status(200).json({ success: true });
      }
    }
  } catch (error) {
    console.error("Handler Error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

async function createTelegramTopic(name) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/createForumTopic`;
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: String(TELEGRAM_BATCH_CHAT_ID).trim(), name: String(name) }) });
    const data = await response.json();
    return data.ok && data.result ? data.result.message_thread_id : null;
  } catch (err) { return null; }
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
    const formData = new FormData();
    formData.append('chat_id', String(targetChatId).trim());
    formData.append('caption', caption);
    if (threadId) formData.append('message_thread_id', String(threadId));
    const blob = new Blob([buffer], { type: 'image/jpeg' });
    formData.append('photo', blob, 'image.jpg');
    await fetch(url, { method: "POST", body: formData });
  } catch (err) {}
}
