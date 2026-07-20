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

      // 🎯 استخراج كافة الصور بأمان
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

        const msg = `👑 *تم تأسيس دفعة جديدة بنجاح!*\n\n` +
                    `🔢 *كود الدفعة الموحد:* \`${finalBatchCode}\`\n` +
                    `👤 *الممثل:* ${cleanText(cleanPayload.repName)}\n` +
                    `📞 *الهاتف:* ${cleanText(cleanPayload.repPhone)}\n` +
                    `🏫 *الجامعة:* ${cleanText(cleanPayload.uniName)} - ${cleanText(cleanPayload.collName)}\n` +
                    `🏛️ *القسم:* ${cleanText(cleanPayload.deptName)}\n` +
                    `👥 *العدد المتوقع:* ${cleanText(cleanPayload.studentCount)}\n` +
                    `🎨 *الموديل:* ${cleanText(cleanPayload.batchModel)}\n` +
                    `🧵 *القماش:* ${cleanText(cleanPayload.batchFabric)}`;

        // تنفيذ الإرسال بالتوازي فائق السرعة
        const tasks = [
          fetch(GOOGLE_SCRIPT_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(cleanPayload)
          }),
          sendTelegramMessage(TELEGRAM_BATCH_CHAT_ID, msg, threadId)
        ];

        if (imagesObj.logoImg) {
          tasks.push(sendTelegramPhoto(TELEGRAM_BATCH_CHAT_ID, imagesObj.logoImg, `📸 شعار الجامعة للدفعة: ${finalBatchCode}`, threadId));
        }

        await Promise.allSettled(tasks);

        return res.status(200).json({ success: true, batchCode: finalBatchCode, threadId: threadId || finalBatchCode });
      }

      // ----------------------------------------------------
      // الحالة ب: انضمام طالب لدفعة (JOIN_BATCH)
      // ----------------------------------------------------
      if (body.actionType === "JOIN_BATCH") {
        const currentBatchCode = String(body.batchCode || body.threadId || "").trim();
        const sName = body.studentName || body.name || "طالب جديد";

        // البحث السريع عن رقم التوبك المباشر
        let realThreadId = body.threadId || null;
        if (!realThreadId && currentBatchCode) {
          if (!isNaN(Number(currentBatchCode)) && Number(currentBatchCode) > 0) {
            realThreadId = Number(currentBatchCode);
          } else {
            try {
              const verifyRes = await fetch(`${GOOGLE_SCRIPT_URL}?actionType=VERIFY_BATCH&batchCode=${encodeURIComponent(currentBatchCode)}`, {
                signal: AbortSignal.timeout(2000)
              });
              const verifyData = await verifyRes.json();
              if (verifyData.success && verifyData.batchData && verifyData.batchData.threadId) {
                realThreadId = verifyData.batchData.threadId;
              }
            } catch(e) {}
          }
        }

        const cleanPayload = {
          actionType: "JOIN_BATCH",
          batchCode: currentBatchCode,
          studentName: sName,
          phone: body.phone || body.studentPhone || "غير متوفر",
          sashSelected: body.sashSelected || "غير محدد",
          lengthGown: body.lengthGown || "0",
          lengthSleeve: body.lengthSleeve || "0",
          shoulder: body.shoulder || "0",
          chest: body.chest || "0",
          head: body.head || "0",
          sashText: body.sashText || "",
          sashFixedText: body.sashFixedText || "",
          sashBackText: body.sashBackText || body.sashBack || "",
          capTopText: body.capTopText || body.capTop || "",
          capSideText: body.capSideText || body.capSide || "",
          additions: body.additions || "",
          images: imagesObj
        };

        const msg = `🤝 *انضمام طالب جديد للدفعة!*
----------------------------------
👤 *اسم الطالب:* ${cleanText(sName)}
----------------------------------
✍️ *التطريز:*
✨ *الوشاح:* ${cleanText(cleanPayload.sashText)}
📌 *الطرف الثابت:* ${cleanText(cleanPayload.sashFixedText || "لا يوجد")}
🎨 *الظهر:* ${cleanText(cleanPayload.sashBackText || "لا يوجد")}
🎩 *فوق القبعة:* ${cleanText(cleanPayload.capTopText || "لا يوجد")}
🧢 *جانب القبعة:* ${cleanText(cleanPayload.capSideText || "لا يوجد")}

➕ *الإضافات:* ${cleanText(cleanPayload.additions)}`;

        // تجهيز المهام للتنفيذ بالتوازي
        const tasks = [
          fetch(GOOGLE_SCRIPT_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(cleanPayload)
          }),
          sendTelegramMessage(TELEGRAM_BATCH_CHAT_ID, msg, realThreadId)
        ];

        const labelMap = { 
          sashBackImg: 'صورة ظهر الوشاح', 
          capTopImg: 'صورة فوق القبعة', 
          capSideImg: 'صورة جانب القبعة' 
        };

        for (const [k, imgBase64] of Object.entries(imagesObj)) {
          if (imgBase64 && k !== 'logoImg') {
            tasks.push(sendTelegramPhoto(TELEGRAM_BATCH_CHAT_ID, imgBase64, `📸 [${labelMap[k] || 'صورة'}] للطالب: ${sName}`, realThreadId));
          }
        }

        // تنفيذ كل شيء بالتوازي الخاطف
        await Promise.allSettled(tasks);

        return res.status(200).json({ success: true });
      }

      // ----------------------------------------------------
      // الحالة ج: طلب فردي (SINGLE_ORDER)
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

        const msg = `🛍️ *طلب فردي جديد بالكامل!*
----------------------------------
👤 *اسم الطالب:* ${cleanText(studentName)}
📞 *رقم الهاتف:* ${cleanText(cleanPayload.phone)}

🎨 *الموديل:* ${cleanText(cleanPayload.batchModel)}
🧵 *نوع القماش:* ${cleanText(cleanPayload.batchFabric)}
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

        const tasks = [
          fetch(GOOGLE_SCRIPT_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(cleanPayload)
          }),
          sendTelegramMessage(TELEGRAM_CHAT_ID, msg)
        ];

        const labelMap = { sashFixedImg: 'صورة الطرف الثابت', sashBackImg: 'صورة ظهر الوشاح', capTopImg: 'صورة فوق القبعة', capSideImg: 'صورة جانب القبعة' };
        for (const [k, imgBase64] of Object.entries(imagesObj)) {
          if (imgBase64 && k !== 'logoImg') {
            tasks.push(sendTelegramPhoto(TELEGRAM_CHAT_ID, imgBase64, `📸 [${labelMap[k] || 'صورة'}] للطالب: ${studentName}`));
          }
        }

        await Promise.allSettled(tasks);

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
    const response = await fetch(url, { 
      method: "POST", 
      headers: { "Content-Type": "application/json" }, 
      body: JSON.stringify({ chat_id: String(TELEGRAM_BATCH_CHAT_ID).trim(), name: String(name) }) 
    });
    const data = await response.json();
    return data.ok && data.result ? data.result.message_thread_id : null;
  } catch (err) { return null; }
}

async function sendTelegramMessage(targetChatId, text, threadId = null) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const payload = { chat_id: String(targetChatId).trim(), text: text, parse_mode: "Markdown" };
    if (threadId && !isNaN(Number(threadId))) payload.message_thread_id = Number(threadId);

    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await res.json();
    
    // التراجع التلقائي: إذا فشل الإرسال داخل التوبك لأي سبب، يُرسل في القناة العامة
    if (!data.ok && payload.message_thread_id) {
      delete payload.message_thread_id;
      await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    }
  } catch (err) {}
}

async function sendTelegramPhoto(targetChatId, base64Data, caption, threadId = null) {
  try {
    if (!base64Data || typeof base64Data !== 'string' || base64Data.length < 50) return;
    let cleanBase64 = base64Data.includes(",") ? base64Data.split(",")[1] : base64Data;
    
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
    const buffer = Buffer.from(cleanBase64, 'base64');
    
    const formData = new FormData();
    formData.append('chat_id', String(targetChatId).trim());
    formData.append('caption', String(caption || ''));
    if (threadId && !isNaN(Number(threadId))) formData.append('message_thread_id', String(threadId));
    formData.append('photo', new Blob([buffer], { type: 'image/jpeg' }), 'image.jpg');

    const res = await fetch(url, { method: "POST", body: formData });
    const data = await res.json();

    if (!data.ok && threadId) {
      const formData2 = new FormData();
      formData2.append('chat_id', String(targetChatId).trim());
      formData2.append('caption', String(caption || ''));
      formData2.append('photo', new Blob([buffer], { type: 'image/jpeg' }), 'image.jpg');
      await fetch(url, { method: "POST", body: formData2 });
    }
  } catch (err) {}
}
