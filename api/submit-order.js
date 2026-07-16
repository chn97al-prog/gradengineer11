// api/submit-order.js (Vercel Serverless Function)
import { kv } from '@vercel/kv';

export const config = {
  maxDuration: 60, // تجنب الـ Timeout مع جوجل شيت
};

// قراءة الإعدادات من الـ Environment Variables بأمان تامة
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL; 
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN; 
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;      // آيدي جروب الدفعات (الذي يحتوي على توبكس)
const TELEGRAM_BATCH_CHAT_ID = process.env.TELEGRAM_BATCH_CHAT_ID;  // آيدي قناة الفردي الخاصة بالطلاب

export default async function handler(req, res) {
  // ترويسات CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  // التحقق من المتغيرات
  if (!GOOGLE_SCRIPT_URL || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !TELEGRAM_BATCH_CHAT_ID) {
    return res.status(500).json({ 
      success: false, 
      error: "يرجى التأكد من ضبط جميع متغيرات البيئة (الجروب، القناة، التوكن، ورابط جوجل) في Vercel." 
    });
  }

  try {
    // 1. عملية التحقق السريعة (GET)
    if (req.method === "GET") {
      const { actionType, batchCode } = req.query;

      if (actionType === "VERIFY_BATCH") {
        if (!batchCode) {
          return res.status(400).json({ success: false, error: "كود الدفعة مطلوب" });
        }

        const savedBatch = await kv.get(`batch:${batchCode.toLowerCase()}`);

        if (savedBatch) {
          return res.status(200).json({ success: true, batchData: savedBatch });
        } else {
          const targetUrl = `${GOOGLE_SCRIPT_URL}?actionType=VERIFY_BATCH&batchCode=${encodeURIComponent(batchCode)}`;
          const response = await fetch(targetUrl, { method: "GET" });
          const result = await response.json();
          
          if (result.success) {
            await kv.set(`batch:${batchCode.toLowerCase()}`, result.batchData);
          }
          return res.status(response.status).json(result);
        }
      }
    }

    // 2. عمليات الإنشاء والانضمام (POST)
    if (req.method === "POST") {
      const body = req.body;

      const response = await fetch(GOOGLE_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const result = await response.json();

      if (result.success) {
        // حالة (أ): تأسيس دفعة جديدة -> ترسل إلى جروب الدفعات داخل توبك جديد
        if (body.actionType === "CREATE_BATCH") {
          const newCode = result.batchCode;
          
          // إنشاء التوبك باسم الدفعة داخل جروب الدفعات
          const threadId = await createTelegramTopic(newCode);
          
          const batchDataToSave = {
            ...result.batchData,
            threadId: threadId 
          };

          await kv.set(`batch:${newCode.toLowerCase()}`, batchDataToSave);
          
          // إرسال الرسالة إلى التوبك الجديد في جروب الدفعات
          await sendTelegramMessage(
            TELEGRAM_CHAT_ID,
            `👑 *تم تأسيس دفعة جديدة بنجاح!*\n\n` +
            `🔑 *كود الدفعة:* \`${newCode}\`\n` +
            `👤 *الممثل (الكامل):* ${body.repName}\n` +
            `📞 *الهاتف:* ${body.repPhone}\n` +
            `🏫 *الجامعة:* ${body.uniName} - ${body.collName}\n` +
            `🎨 *الموديل:* ${body.batchModel}`,
            threadId
          );
        }

        // حالة (ب): انضمام طالب جديد -> ترسل إلى قناة الفردي الخاصة بالطلاب
        if (body.actionType === "JOIN_BATCH") {
          const batchCode = body.batchCode;

          // إرسال الإشعار مباشرة إلى القناة الخاصة بالفردي (بدون توبك لأنها قناة وليست مجموعة)
          await sendTelegramMessage(
            TELEGRAM_BATCH_CHAT_ID,
            `🤝 *طالب جديد انضم للفردي!*\n\n` +
            `🔑 *كود الدفعة:* \`${batchCode}\`\n` +
            `👤 *اسم الطالب:* ${body.studentName}\n` +
            `✨ *اسم الوشاح:* ${body.sashText}\n` +
            `🎨 *تفاصيل التطريز:* ${body.sashBackText || "لا يوجد"}\n` +
            `➕ *الإضافات:* ${body.additions || "لا توجد"}`
          );
        }
      }

      return res.status(response.status).json(result);
    }

    return res.status(405).json({ success: false, error: "الطريقة غير مسموح بها" });

  } catch (error) {
    console.error("Vercel Function Error:", error);
    return res.status(500).json({ success: false, error: "حدث خطأ في الاتصال بالسيرفر: " + error.message });
  }
}

// دالة لإنشاء Topic جديد في جروب الدفعات
async function createTelegramTopic(name) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/createForumTopic`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID, // يُنشأ التوبك دائماً في جروب الدفعات الرئيسي
        name: name 
      })
    });
    const data = await response.json();
    if (data.ok) {
      return data.result.message_thread_id; 
    }
    return null;
  } catch (err) {
    console.error("خطأ في إنشاء التوبك:", err);
    return null;
  }
}

// دالة إرسال الرسائل الديناميكية (تستقبل الـ Chat ID المستهدف والتوبك إن وجد)
async function sendTelegramMessage(targetChatId, text, threadId = null) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const payload = {
      chat_id: targetChatId,
      text: text,
      parse_mode: "Markdown"
    };
    
    // إذا أرسلنا لجروب الدفعات وكان هناك توبك، نوجهها داخل التوبك
    if (threadId && targetChatId === TELEGRAM_CHAT_ID) {
      payload.message_thread_id = threadId;
    }

    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.error("خطأ في إرسال تليجرام:", err);
  }
}
