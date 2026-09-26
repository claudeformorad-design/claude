import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  agentRules: false,
  // قاعدة وضع التجربة المحلية (PostgreSQL مضمّن WASM) تعمل على الخادم فقط ولا تُحزم
  serverExternalPackages: ["@electric-sql/pglite"],
  // ملفات الترحيل تُقرأ وقت التشغيل لبناء قاعدة التجربة المحلية
  outputFileTracingIncludes: {
    "/**": ["./supabase/migrations/*.sql", "./supabase/tests/supabase_shim.sql"],
  },
  experimental: {
    // يتيح forbidden() لصفحات الصلاحيات (403)
    authInterrupts: true,
  },
};

export default nextConfig;
