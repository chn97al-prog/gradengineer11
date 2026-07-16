// api/submit-order.js (Vercel Serverless Function)
import { kv } from '@vercel/kv'; // تأكد من ربط Vercel KV بمشروعك من لوحة التحكم

export const config = {
  maxDuration: 60, // زيادة مهلة الانتظار تجنباً لمشاكل سيرفر جوجل
};

// ضع رابط الـ WebApp الخاص بـ Google Apps Script بعد التحديث هنا
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/XXXXXXXXXXXX/exec"; 

// إعدادات بوت التليجرام الخاص بك للإشعارات الفورية
const TELEGRAM_BOT_TOKEN = "YOUR_TELEGRAM_BOT_TOKEN"; 
const TELEGRAM_CHAT_ID = "YOUR_TELEGRAM_CHAT_ID";     

export default async function handler(req, res) {
  // ترويسات CORS للسماح بالوصول من صفحة الويب
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    // 1. التحقق الفوري والسريع (GET) من خلال Vercel KV دون مراجعة جوجل شيت
    if (req.method === "GET") {
      const { actionType, batchCode } = req.query;

      if (actionType === "VERIFY_BATCH") {
        if (!batchCode) {
          return res.status(400).json({ success: false, error: "كود الدفعة مطلوب" });
        }

        // جلب تفاصيل الدفعة من ذاكرة Vercel السريعة مباشرة
        const savedBatch = await kv.get(`batch:${batchCode.toLowerCase()}`);

        if (savedBatch) {
          return res.status(200).json({
            success: true,
            batchData: savedBatch
          });
        } else {
          // خطة احتياطية: إذا لم تكن مخزنة في KV، يتم جلبها من جوجل شيت
          const targetUrl = `${GOOGLE_SCRIPT_URL}?actionType=VERIFY_BATCH&batchCode=${encodeURIComponent(batchCode)}`;
          const response = await fetch(targetUrl, { method: "GET" });
          const result = await response.json();
          
          if (result.success) {
            // حفظها في الـ KV لتسريع عمليات الفحص اللاحقة للطلاب الآخرين
            await kv.set(`batch:${batchCode.toLowerCase()}`, result.batchData);
          }
          return res.status(response.status).json(result);
        }
      }
    }

    // 2. عمليات الإنشاء والانضمام (POST)
    if (req.method === "POST") {
      const body = req.body;

      // إرسال الطلب لـ Google Sheets لتسجيله وتوليد الكود التسلسلي
      const response = await fetch(GOOGLE_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const result = await response.json();

      if (result.success) {
        // حالة (أ): تأسيس دفعة جديدة
        if (body.actionType === "CREATE_BATCH") {
          const newCode = result.batchCode;
          
          // حفظ كود الدفعة ومعلوماتها فوراً في Vercel KV للطلاب
          await kv.set(`batch:${newCode.toLowerCase()}`, result.batchData);
          
          // إرسال إشعار تليجرام فوري بتفاصيل الدفعة المضافة
          await sendTelegramMessage(
            `👑 *تم تأسيس دفعة جديدة بنجاح!*\n\n` +
            `🔑 *كود الدفعة:* \`${newCode}\`\n` +
            `👤 *الممثل (الكامل):* ${body.repName}\n` +
            `📞 *الهاتف:* ${body.repPhone}\n` +
            `🏫 *الجامعة:* ${body.uniName} - ${body.collName}\n` +
            `🎨 *الموديل:* ${body.batchModel}`
          );
        }

        // حالة (ب): انضمام طالب جديد للدفعة
        if (body.actionType === "JOIN_BATCH") {
          // إرسال إشعار تليجرام بانضمام الطالب الجديد
          await sendTelegramMessage(
            `🤝 *طالب جديد انضم للدفعة!*\n\n` +
            `🔑 *كود الدفعة:* \`${body.batchCode}\`\n` +
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
    return res.status(500).json({ success: false, error: "حدث خطأ في الاتصال: " + error.message });
  }
}

// دالة إرسال الإشعارات لبوت التليجرام
async function sendTelegramMessage(text) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: text,
        parse_mode: "Markdown"
      })
    });
  } catch (err) {
    console.error("خطأ في إرسال تليجرام:", err);
  }
}
