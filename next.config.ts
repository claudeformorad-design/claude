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

/** رؤوس أمان لكل الاستجابات (والصفحات تأخذ فوقها سياسة المحتوى برمز لكل طلب من proxy) */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  agentRules: false,
  allowedDevOrigins: previewOrigins,
  // قاعدة وضع التجربة المحلية (PostgreSQL مضمّن WASM) ومولّد PDF يعملان على الخادم فقط ولا يُحزمان
  serverExternalPackages: ["@electric-sql/pglite", "pdfkit", "bwip-js"],
  // ملفات الترحيل تُقرأ وقت التشغيل لبناء قاعدة التجربة المحلية، وخطوط ملف PDF وقت توليده
  outputFileTracingIncludes: {
    "/**": ["./supabase/migrations/*.sql", "./supabase/tests/supabase_shim.sql", "./src/lib/export/fonts/*.ttf"],
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
