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
      let body = req.body || {};
      if (typeof body === "string") {
        try { body = JSON.parse(body); } catch (e) {}
      }

      const cleanText = (str) => (!str ? "غير متوفر" : String(str).replace(/[_*`\[\]()]/g, "\\$&"));

      const parseImages = (data) => {
        let resObj = {};
        try {
          let raw = data.images || data;
          if (typeof raw === 'object' && !Array.isArray(raw)) {
            resObj.logoImg = raw.logoImg || raw.logo || raw.uniLogo || data.logoImg || data.logo || null;
            resObj.sashFixedImg = raw.sashFixedImg || raw.sashFixed || data.sashFixedImg || null;
            resObj.sashBackImg = raw.sashBackImg || raw.sashBack || data.sashBackImg || null;
            resObj.capTopImg = raw.capTopImg || raw.capTop || data.capTopImg || null;
            resObj.capSideImg = raw.capSideImg || raw.capSide || data.capSideImg || null;
          }
          for (let key in resObj) {
            if (resObj[key] && typeof resObj[key] === 'object') {
              resObj[key] = resObj[key].base64 || resObj[key].data || resObj[key].url || null;
            }
          }
        } catch(e) {}
        return resObj;
      };

      const imagesObj = parseImages(body);

      // 🎯 الخدعة السحرية: إرسال لجوجل مع مهلة 3 ثوانٍ فقط لفك ارتباط Vercel
      const sendToGoogleNonBlocking = (payload) => {
        return Promise.race([
          fetch(GOOGLE_SCRIPT_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          }),
          // ننتظر 3 ثواني كحد أقصى لتأكيد استلام جوجل للبيانات، ثم ننهي الانتظار
          // سيستمر جوجل بمعالجة ورفع الصور في الخلفية براحته!
          new Promise(resolve => setTimeout(resolve, 3000))
        ]);
      };

      // ----------------------------------------------------
      // الحالة أ: تأسيس دفعة جديدة (CREATE_BATCH)
      // ----------------------------------------------------
      if (body.actionType === "CREATE_BATCH") {
        const topicName = `${body.uniName || 'دفعة جديدة'} - ${body.collName || ''} - ${body.repName || ''}`;
        const threadId = await createTelegramTopic(topicName);
        const finalBatchCode = String(body.batchCode || body.code || threadId || "BATCH").trim();

        const cleanPayload = {
          actionType: "CREATE_BATCH",
          batchCode: finalBatchCode,
          threadId: threadId || finalBatchCode,
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

        const msg = `👑 *تم تأسيس دفعة جديدة بنجاح!*\n🔢 *كود الدفعة:* \`${finalBatchCode}\`\n👤 *الممثل:* ${cleanText(cleanPayload.repName)}`;

        // نرسل لجوجل والنص لتليجرام بالتوازي السريع
        await Promise.allSettled([
          sendToGoogleNonBlocking(cleanPayload),
          sendTelegramMessage(TELEGRAM_BATCH_CHAT_ID, msg, threadId)
        ]);

        if (imagesObj.logoImg) {
          await sendTelegramPhoto(TELEGRAM_BATCH_CHAT_ID, imagesObj.logoImg, `📸 شعار الجامعة للدفعة: ${finalBatchCode}`, threadId);
        }

        return res.status(200).json({ success: true, batchCode: finalBatchCode, threadId: threadId || finalBatchCode });
      }

      // ----------------------------------------------------
      // الحالة ب: انضمام طالب لدفعة (JOIN_BATCH)
      // ----------------------------------------------------
      if (body.actionType === "JOIN_BATCH") {
        const currentBatchCode = String(body.batchCode || body.threadId || "").trim();
        const sName = body.studentName || body.name || "طالب جديد";

        let realThreadId = body.threadId || null;
        if (!realThreadId && currentBatchCode && !isNaN(Number(currentBatchCode))) {
            realThreadId = Number(currentBatchCode);
        }

        const cleanPayload = {
          actionType: "JOIN_BATCH",
          batchCode: currentBatchCode,
          studentName: sName,
          phone: body.phone || "غير متوفر",
          sashSelected: body.sashSelected || "غير محدد",
          lengthGown: body.lengthGown || "0",
          lengthSleeve: body.lengthSleeve || "0",
          shoulder: body.shoulder || "0",
          chest: body.chest || "0",
          head: body.head || "0",
          sashText: body.sashText || "",
          sashFixedText: body.sashFixedText || "",
          sashBackText: body.sashBackText || "",
          capTopText: body.capTopText || "",
          capSideText: body.capSideText || "",
          additions: body.additions || "",
          images: imagesObj
        };

        const msg = `🤝 *انضمام طالب جديد!*\n👤 *الطالب:* ${cleanText(sName)}\n🔢 *الكود:* \`${currentBatchCode}\``; // تم اختصار النص هنا لتقليل الحجم، يمكنك إعادته كما كان

        // إرسال النص لجوجل وتليجرام (ينتهي في 3 ثواني كحد أقصى)
        await Promise.allSettled([
          sendToGoogleNonBlocking(cleanPayload),
          sendTelegramMessage(TELEGRAM_BATCH_CHAT_ID, msg, realThreadId)
        ]);

        // إرسال الصور لتليجرام بتتابع سريع (لتجنب حظر تليجرام 429)
        const labelMap = { sashFixedImg: 'الطرف الثابت', sashBackImg: 'ظهر الوشاح', capTopImg: 'فوق القبعة', capSideImg: 'جانب القبعة' };
        for (const [k, imgBase64] of Object.entries(imagesObj)) {
          if (imgBase64 && k !== 'logoImg') {
            await sendTelegramPhoto(TELEGRAM_BATCH_CHAT_ID, imgBase64, `📸 صورة [${labelMap[k] || 'مرفقة'}] للطالب: ${sName}`, realThreadId);
          }
        }

        return res.status(200).json({ success: true });
      }

      // ----------------------------------------------------
      // الحالة ج: طلب فردي (SINGLE_ORDER)
      // ----------------------------------------------------
      if (["SINGLE_ORDER", "INDIVIDUAL_ORDER"].includes(body.actionType)) {
        const studentName = body.studentName || "طالب مجهول";
        const cleanPayload = { ...body, actionType: "SINGLE_ORDER", images: imagesObj };
        const msg = `🛍️ *طلب فردي جديد!*\n👤 *اسم الطالب:* ${cleanText(studentName)}`;

        await Promise.allSettled([
          sendToGoogleNonBlocking(cleanPayload),
          sendTelegramMessage(TELEGRAM_CHAT_ID, msg)
        ]);

        const labelMap = { sashFixedImg: 'الطرف الثابت', sashBackImg: 'ظهر الوشاح', capTopImg: 'فوق القبعة', capSideImg: 'جانب القبعة' };
        for (const [k, imgBase64] of Object.entries(imagesObj)) {
          if (imgBase64 && k !== 'logoImg') {
            await sendTelegramPhoto(TELEGRAM_CHAT_ID, imgBase64, `📸 صورة [${labelMap[k] || 'مرفقة'}] للطالب: ${studentName}`);
          }
        }

        return res.status(200).json({ success: true });
      }
    }
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// --- الدوال المساعدة للتليجرام ---
async function createTelegramTopic(name) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/createForumTopic`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: String(TELEGRAM_BATCH_CHAT_ID).trim(), name: String(name) }) });
    const data = await res.json();
    return data.ok ? data.result.message_thread_id : null;
  } catch (err) { return null; }
}

async function sendTelegramMessage(targetChatId, text, threadId = null) {
  try {
    const payload = { chat_id: String(targetChatId).trim(), text: text, parse_mode: "Markdown" };
    if (threadId) payload.message_thread_id = Number(threadId);
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!data.ok && payload.message_thread_id) {
      delete payload.message_thread_id;
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    }
  } catch (err) {}
}

async function sendTelegramPhoto(targetChatId, base64Data, caption, threadId = null) {
  try {
    if (!base64Data || base64Data.length < 50) return;
    let cleanBase64 = base64Data.includes(",") ? base64Data.split(",")[1] : base64Data;
    const buffer = Buffer.from(cleanBase64, 'base64');
    const formData = new FormData();
    formData.append('chat_id', String(targetChatId).trim());
    formData.append('caption', String(caption || ''));
    if (threadId) formData.append('message_thread_id', String(threadId));
    formData.append('photo', new Blob([buffer], { type: 'image/jpeg' }), 'image.jpg');

    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, { method: "POST", body: formData });
    const data = await res.json();
    if (!data.ok && threadId) {
      formData.delete('message_thread_id');
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, { method: "POST", body: formData });
    }
  } catch (err) {}
}
