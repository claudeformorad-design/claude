/** عند تشغيل الخادم: جدولة النسخ الاحتياطي اليومي في وضع التشغيل المحلي (بلا Supabase) */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { isSupabaseConfigured } = await import("@/lib/supabase/env");
  if (isSupabaseConfigured() || process.env.AUTO_BACKUP === "off") return;
  const { startAutoBackupScheduler } = await import("@/lib/supabase/auto-backup");
  startAutoBackupScheduler();
}
