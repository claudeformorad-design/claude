import type { NextConfig } from "next";

/**
 * نطاقات المعاينة المستضافة (Google AI Studio / Cloud Run / Firebase / Codespaces ...).
 * خادم التطوير في Next.js 16 يرفض (403) ملفات JavaScript الداخلية (/_next/*) لأي نطاق غير
 * localhost أو العنوان الذي شُغّل عليه، فتظهر الصفحات بلا تفاعل. يمكن إضافة نطاقات أخرى
 * دون تعديل الكود عبر المتغير ALLOWED_DEV_ORIGINS (مفصولة بفواصل، وتقبل ** مثل **.example.com).
 */
const extraOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const previewOrigins = [
  "**.run.app",
  "**.goog",
  "**.google.com",
  "**.googleusercontent.com",
  "**.web.app",
  "**.firebaseapp.com",
  "**.cloudworkstations.dev",
  "**.github.dev",
  "**.gitpod.io",
  "**.csb.app",
  ...extraOrigins,
];

// وضع التجربة المحلي = بدون Supabase. نسمح فيه بطلبات النماذج (Server Actions) القادمة عبر
// وكيل المعاينة؛ في الإنتاج مع Supabase يبقى الفحص الافتراضي الصارم (نفس النطاق فقط) ما لم تُحدَّد نطاقات صراحةً.
const trialMode = !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const nextConfig: NextConfig = {
  output: "standalone",
  agentRules: false,
  allowedDevOrigins: previewOrigins,
  // قاعدة وضع التجربة المحلية (PostgreSQL مضمّن WASM) تعمل على الخادم فقط ولا تُحزم
  serverExternalPackages: ["@electric-sql/pglite"],
  // ملفات الترحيل تُقرأ وقت التشغيل لبناء قاعدة التجربة المحلية
  outputFileTracingIncludes: {
    "/**": ["./supabase/migrations/*.sql", "./supabase/tests/supabase_shim.sql"],
  },
  experimental: {
    // يتيح forbidden() لصفحات الصلاحيات (403)
    authInterrupts: true,
    // الصفحات المزارة أو المجلوبة مسبقًا تبقى صالحة 30 ثانية (رجوع وتنقل فوري بين الأقسام)؛
    // أي عملية حفظ تُبطلها فورًا عبر revalidatePath/router.refresh فلا تظهر أرقام قديمة بعد التعديل
    staleTimes: { dynamic: 30, static: 30 },
    serverActions: {
      allowedOrigins: trialMode ? previewOrigins : extraOrigins,
      // استعادة النسخة الاحتياطية ترفع ملف القاعدة كاملًا
      bodySizeLimit: "200mb",
    },
  },
};

export default nextConfig;
