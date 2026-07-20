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

      // 🎯 محرك استخراج الصور
      const parseAllImages = (data) => {
        let result = {};
        const possibleKeys = {
          logoImg: ['logoImg', 'logo', 'uniLogo', 'universityLogo', 'base64', 'file'],
          sashFixedImg: ['sashFixedImg', 'sashFixed', 'fixedImg', 'fixed'],
          sashBackImg: ['sashBackImg', 'sashBack', 'backImg', 'back'],
          capTopImg: ['capTopImg', 'capTop', 'topImg', 'top'],
          capSideImg: ['capSideImg', 'capSide', 'sideImg', 'side']
        };

        const extractBase64 = (val) => {
          if (!val) return null;
          if (typeof val === 'string' && val.length > 50) return val;
          if (typeof val === 'object') return val.base64 || val.data || val.url || null;
          return null;
        };

        if (data.images && typeof data.images === 'object' && !Array.isArray(data.images)) {
          for (let target in possibleKeys) {
            for (let alias of possibleKeys[target]) {
              let val = extractBase64(data.images[alias]);
              if (val) { result[target] = val; break; }
            }
          }
        }

        if (data.images && Array.isArray(data.images)) {
          data.images.forEach(item => {
            let itemKey = item.key || item.name || item.type || item.label || "";
            let itemVal = extractBase64(item.base64 || item.data || item.val || item);
            if (itemKey && itemVal) {
              for (let target in possibleKeys) {
                if (possibleKeys[target].some(k => itemKey.toLowerCase().includes(k.toLowerCase()))) {
                  result[target] = itemVal;
                }
              }
            }
          });
        }

        for (let target in possibleKeys) {
          if (!result[target]) {
            for (let alias of possibleKeys[target]) {
              let val = extractBase64(data[alias]);
              if (val) { result[target] = val; break; }
            }
          }
        }

        return result;
      };

      const imagesObj = parseAllImages(body);

      // ----------------------------------------------------
      // الحالة أ: تأسيس دفعة جديدة (CREATE_BATCH)
      // ----------------------------------------------------
      if (body.actionType === "CREATE_BATCH") {
        const topicName = `${body.uniName || 'دفعة جديدة'} - ${body.repName || ''}`;
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

        const messageText = `👑 *تم تأسيس دفعة جديدة بنجاح!*\n\n` +
                            `🔢 *كود الدفعة الموحد:* \`${finalBatchCode}\`\n` +
                            `👤 *الممثل:* ${cleanText(cleanPayload.repName)}\n` +
                            `📞 *الهاتف:* ${cleanText(cleanPayload.repPhone)}\n` +
                            `🏫 *الجامعة:* ${cleanText(cleanPayload.uniName)} - ${cleanText(cleanPayload.collName)}\n` +
                            `🏛️ *القسم:* ${cleanText(cleanPayload.deptName)}\n` +
                            `👥 *عدد الطلاب المتوقع:* ${cleanText(cleanPayload.studentCount)}\n` +
                            `🎨 *الموديل المعتمد:* ${cleanText(cleanPayload.batchModel)}\n` +
                            `🧵 *القماش:* ${cleanText(cleanPayload.batchFabric)}`;

        await sendTelegramMessage(TELEGRAM_BATCH_CHAT_ID, messageText, threadId);

        if (imagesObj.logoImg) {
          await sendTelegramPhoto(TELEGRAM_BATCH_CHAT_ID, imagesObj.logoImg, `📸 شعار الجامعة للدفعة: ${finalBatchCode}`, threadId);
        }

        try {
          await fetch(GOOGLE_SCRIPT_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(cleanPayload),
          });
        } catch (e) { console.error("Sheet Error:", e); }

        return res.status(200).json({ success: true, batchCode: finalBatchCode, code: finalBatchCode, threadId: threadId || finalBatchCode });
      }

      // ----------------------------------------------------
      // الحالة ب: انضمام طالب لدفعة (JOIN_BATCH)
      // ----------------------------------------------------
      if (body.actionType === "JOIN_BATCH") {
        const currentBatchCode = String(body.batchCode || body.threadId || "").trim();
        const sName = body.studentName || body.name || "طالب جديد";

        let realThreadId = body.threadId || body.batchCode;

        // 🔍 استعلام تلقائي لجلب رقم التوبك الحقيقي من كوكل شيت إذا لم يكن رقماً صريحاً
        if (!getValidThreadId(realThreadId)) {
          try {
            const vRes = await fetch(`${GOOGLE_SCRIPT_URL}?actionType=VERIFY_BATCH&batchCode=${encodeURIComponent(currentBatchCode)}`);
            const vData = await vRes.json();
            if (vData.success && vData.batchData && vData.batchData.threadId) {
              realThreadId = vData.batchData.threadId;
            }
          } catch(e) {}
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

        const messageText = `🤝 *انضمام طالب جديد للدفعة!*
----------------------------------
👤 *اسم الطالب:* ${cleanText(sName)}
📞 *الهاتف:* ${cleanText(cleanPayload.phone)}
🔢 *كود الدفعة:* \`${currentBatchCode}\`
----------------------------------
✍️ *التطريز:*
✨ *الوشاح:* ${cleanText(cleanPayload.sashText)}
📌 *الطرف الثابت:* ${cleanText(cleanPayload.sashFixedText || "لا يوجد")}
🎨 *الظهر:* ${cleanText(cleanPayload.sashBackText || "لا يوجد")}
🎩 *فوق القبعة:* ${cleanText(cleanPayload.capTopText || "لا يوجد")}
🧢 *جانب القبعة:* ${cleanText(cleanPayload.capSideText || "لا يوجد")}

➕ *الإضافات:* ${cleanText(cleanPayload.additions)}`;

        // إرسال للتوبك المحدد حصراً
        await sendTelegramMessage(TELEGRAM_BATCH_CHAT_ID, messageText, realThreadId);

        const labelMap = { 
          sashBackImg: 'صورة ظهر الوشاح', 
          capTopImg: 'صورة فوق القبعة', 
          capSideImg: 'صورة جانب القبعة' 
        };

        for (const [k, imgBase64] of Object.entries(imagesObj)) {
          if (imgBase64 && k !== 'logoImg') {
            await sendTelegramPhoto(TELEGRAM_BATCH_CHAT_ID, imgBase64, `📸 [${labelMap[k] || 'صورة'}] للطالب: ${sName}`, realThreadId);
          }
        }

        try {
          await fetch(GOOGLE_SCRIPT_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(cleanPayload),
          });
        } catch (e) { console.error("Sheet Error:", e); }

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

        const messageText = `🛍️ *طلب فردي جديد بالكامل!*
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

        await sendTelegramMessage(TELEGRAM_CHAT_ID, messageText);

        const labelMap = { sashFixedImg: 'صورة الطرف الثابت', sashBackImg: 'صورة ظهر الوشاح', capTopImg: 'صورة فوق القبعة', capSideImg: 'صورة جانب القبعة' };
        for (const [k, imgBase64] of Object.entries(imagesObj)) {
          if (imgBase64 && k !== 'logoImg') {
            await sendTelegramPhoto(TELEGRAM_CHAT_ID, imgBase64, `📸 [${labelMap[k] || 'صورة'}] للطالب: ${studentName}`);
          }
        }

        try {
          await fetch(GOOGLE_SCRIPT_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(cleanPayload),
          });
        } catch (e) { console.error("Sheet Error:", e); }

        return res.status(200).json({ success: true });
      }
    }
  } catch (error) {
    console.error("Handler Error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

function getValidThreadId(val) {
  if (!val) return null;
  const num = Number(val);
  return (!isNaN(num) && num > 0) ? num : null;
}

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
    const validThread = getValidThreadId(threadId);
    const payload = { chat_id: String(targetChatId).trim(), text: text, parse_mode: "Markdown" };
    if (validThread) payload.message_thread_id = validThread;

    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  } catch (err) {}
}

async function sendTelegramPhoto(targetChatId, base64Data, caption, threadId = null) {
  try {
    if (!base64Data || typeof base64Data !== 'string' || base64Data.length < 50) return;
    if (base64Data.includes(",")) base64Data = base64Data.split(",")[1];
    
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
    const buffer = Buffer.from(base64Data, 'base64');
    const validThread = getValidThreadId(threadId);
    
    const formData = new FormData();
    formData.append('chat_id', String(targetChatId).trim());
    formData.append('caption', caption);
    if (validThread) formData.append('message_thread_id', String(validThread));
    formData.append('photo', new Blob([buffer], { type: 'image/jpeg' }), 'image.jpg');

    await fetch(url, { method: "POST", body: formData });
  } catch (err) {}
}
