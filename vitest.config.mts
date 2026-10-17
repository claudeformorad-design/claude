import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // أول تشغيل على قرص بارد قد يتجاوز 5 ثوانٍ (اختبار الترجمة يقرأ كل ملفات الترحيل)
    testTimeout: 30000,
  },
});
