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
    // ----------------------------------------------------
    // التحقق المباشر عبر (GET)
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
    // معالجة طلبات الإرسال (POST)
    // ----------------------------------------------------
    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") body = JSON.parse(body);

      const cleanText = (str) => (!str ? "غير متوفر" : String(str).replace(/[_*`\[\]()]/g, "\\$&"));

      // 🎯 دالة استخراج الصور وتحديد نوعها تلقائياً حسب مفاتيح استمارتك
      const extractLabeledImages = (imagesObj) => {
        const labelMapping = {
          sashFixedImg: "صورة الطرف الثابت للوشاح",
          sashBackImg: "صورة ظهر الوشاح",
          capTopImg: "صورة تطريز فوق القبعة",
          capSideImg: "صورة جانب القبعة"
        };

        let resultList = [];
        if (!imagesObj || typeof imagesObj !== 'object') return resultList;

        for (const [key, value] of Object.entries(imagesObj)) {
          if (value && typeof value === 'object' && value.base64) {
            resultList.push({
              label: labelMapping[key] || "صورة مرفقة",
              base64: value.base64
            });
          } else if (typeof value === 'string' && value.length > 100) {
            resultList.push({
              label: labelMapping[key] || "صورة مرفقة",
              base64: value
            });
          }
        }
        return resultList;
      };

      const extractedImages = extractLabeledImages(body.images);
      const firstImageBase64 = extractedImages.length > 0 ? extractedImages[0].base64 : null;

      // ----------------------------------------------------
      // الحالة أ: تأسيس دفعة جديدة (CREATE_BATCH)
      // ----------------------------------------------------
      if (body.actionType === "CREATE_BATCH") {
        const topicName = `${body.uniName || 'دفعة جديدة'} - ${body.repName || ''}`;
        const threadId = await createTelegramTopic(topicName);

        if (!threadId) return res.status(500).json({ success: false, error: "فشل إنشاء التوبك في تليجرام" });

        const finalNumericCode = String(threadId).trim();

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
          batchModel: body.batchModel || body.model || "غير محدد",
          batchFabric: body.batchFabric || body.fabric || "غير محدد",
          base64: firstImageBase64
        };

        await fetch(GOOGLE_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cleanPayload),
        });

        const messageText = `👑 *تم تأسيس دفعة جديدة بنجاح!*\n\n` +
                            `🔢 *كود الدفعة الموحد:* \`${finalNumericCode}\`\n` +
                            `👤 *الممثل:* ${cleanText(cleanPayload.repName)}\n` +
                            `📞 *الهاتف:* ${cleanText(cleanPayload.repPhone)}\n` +
                            `🏫 *الجامعة:* ${cleanText(cleanPayload.uniName)} - ${cleanText(cleanPayload.collName)}\n` +
                            `🎨 *الموديل المعتمد:* ${cleanText(cleanPayload.batchModel)}\n` +
                            `🧵 *القماش:* ${cleanText(cleanPayload.batchFabric)}`;

        await sendTelegramMessage(TELEGRAM_BATCH_CHAT_ID, messageText, threadId);

        if (extractedImages.length > 0) {
          await sendTelegramPhoto(TELEGRAM_BATCH_CHAT_ID, extractedImages[0].base64, `📸 ${extractedImages[0].label} لدفعة رقم: ${finalNumericCode}`, threadId);
        }

        return res.status(200).json({ success: true, batchCode: finalNumericCode });
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
          sashBack: body.sashBack || body.sashBackText || "",
          capTop: body.capTop || "",
          capSide: body.capSide || "",
          additions: body.additions || "",
          base64: firstImageBase64
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

          for (let i = 0; i < extractedImages.length; i++) {
            await sendTelegramPhoto(TELEGRAM_BATCH_CHAT_ID, extractedImages[i].base64, `📸 [${extractedImages[i].label}] للطالب: ${sName}`, threadId);
          }
        }
        return res.status(200).json(result);
      }

      // ----------------------------------------------------
      // الحالة ج: طلب فردي متكامل (SINGLE_ORDER / INDIVIDUAL_ORDER)
      // ----------------------------------------------------
      if (["SINGLE_ORDER", "INDIVIDUAL_ORDER"].includes(body.actionType)) {
        const studentName = body.studentName || "طالب مجهول";
        
        // تجهيز كل الحقول لشيت جوجل
        const cleanPayload = {
          actionType: "SINGLE_ORDER",
          studentName: studentName,
          phone: body.phone || "غير متوفر",
          batchModel: body.batchModel || "غير محدد",
          batchFabric: body.batchFabric || "غير محدد",
          sashSelected: body.sashSelected || "لا ينطبق",
          // القياسات
          lengthGown: body.lengthGown || "0",
          lengthSleeve: body.lengthSleeve || "0",
          shoulder: body.shoulder || "0",
          chest: body.chest || "0",
          head: body.head || "0",
          // نصوص التطريز
          sashText: body.sashText || "",
          sashFixedText: body.sashFixedText || "لم يكتب شيء",
          sashBackText: body.sashBackText || "لم يكتب شيء",
          capTopText: body.capTopText || "لم يكتب شيء",
          capSideText: body.capSideText || "لم يكتب شيء",
          additions: body.additions || "لا توجد إضافات",
          base64: firstImageBase64
        };

        // 1. إرسال البيانات لجوجل شيت
        const response = await fetch(GOOGLE_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cleanPayload),
        });
        const result = await response.json();

        if (result.success) {
          // 2. إرسال ملخص الطلب الفردي الشامل إلى التليجرام
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

          // 3. إرسال كل صورة مرفقة مع اسم مكانها المحدد في التليجرام
          for (let k = 0; k < extractedImages.length; k++) {
            const img = extractedImages[k];
            await sendTelegramPhoto(TELEGRAM_CHAT_ID, img.base64, `📸 [${img.label}] للطالب: ${studentName}`);
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

// ----------------------------------------------------
// الدوال المساعدة للتليجرام
// ----------------------------------------------------
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
  } catch (err) {
    console.error("Telegram Photo Error:", err);
  }
}
