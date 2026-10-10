import "server-only";
import { cache } from "react";
import type { AppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { isSupabaseConfigured } from "@/lib/supabase/env";

/**
 * من يدير إعدادات النظام كله (الفورمات ومفتاح المساعد الذكي):
 * في النسخة المنشورة صاحب النظام وحده، وفي التثبيت المحلي مدير الفندق.
 * للعرض فقط: الحماية الفعلية في الدوال نفسها.
 */
export const isSystemAdmin = cache(async (ctx: AppContext): Promise<boolean> => {
  if (!isSupabaseConfigured()) return ctx.can(PERMISSIONS.hotelManage);
  const { data } = await ctx.supabase.rpc("is_system_owner");
  return data === true;
});
