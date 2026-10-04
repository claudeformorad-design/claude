"use server";

import { cookies } from "next/headers";
import { LOCALE_COOKIE, type Locale } from "@/i18n/config";
import { createClient } from "@/lib/supabase/server";

const YEAR = 60 * 60 * 24 * 365;

async function setCookie(locale: Locale) {
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: YEAR, sameSite: "lax", httpOnly: false });
}

/** تغيير لغة الواجهة: تُحفظ في المتصفح وفي ملف المستخدم فتتبعه على أي جهاز يدخل منه */
export async function setLocaleAction(locale: string): Promise<void> {
  const value: Locale = locale === "en" ? "en" : "ar";
  await setCookie(value);
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    if (data.user) await supabase.from("users_profiles").update({ preferred_locale: value }).eq("id", data.user.id);
  } catch {
    // صفحة الدخول بلا مستخدم: يكفي الكوكي
  }
}

/** بعد الدخول: لغة الواجهة من تفضيل المستخدم المحفوظ */
export async function applyPreferredLocale(locale: string | null | undefined): Promise<void> {
  if (locale === "en" || locale === "ar") await setCookie(locale);
}
