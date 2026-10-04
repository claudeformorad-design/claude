"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { tr } from "@/i18n/tr";
import { STAFF_DOMAIN } from "@/lib/auth/staff";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { applyPreferredLocale } from "../locale-actions";

export type AuthState = { error?: "invalid" | "validation" | "generic"; info?: "check_email"; message?: string } | null;

const credentials = z.object({
  email: z.email(),
  password: z.string().min(8).max(72),
  full_name: z.string().trim().max(200).optional(),
});

/** حسابات الموظفين باسم مستخدم: يُكتب الاسم وحده فيُكمَل بنطاق حسابات النظام */
const loginId = z.string().trim().toLowerCase().max(254).transform((v) => (v.includes("@") ? v : `${v}@${STAFF_DOMAIN}`)).pipe(z.email());

export async function signInAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = z.object({ email: loginId, password: z.string().min(1).max(72) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "invalid" };
  let mustChange = false;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });
    if (error) return { error: "invalid" };
    if (data.user) {
      const { data: profile } = await supabase.from("users_profiles").select("preferred_locale, must_change_password").eq("id", data.user.id).maybeSingle();
      await applyPreferredLocale(profile?.preferred_locale);
      mustChange = profile?.must_change_password === true;
    }
  } catch {
    // لا تُعرض تفاصيل الخطأ الداخلي على صفحة الدخول
    return { error: "generic" };
  }
  redirect(mustChange ? "/account/password" : "/?home=1");
}

export async function signUpAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = credentials.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "validation" };
  let needsOnboarding = false;
  try {
    const supabase = await createClient();
    const origin = (await headers()).get("origin");
    const { data, error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: { data: { full_name: parsed.data.full_name ?? "" }, emailRedirectTo: origin ? `${origin}/login` : undefined },
    });
    // رفض قاعدة البيانات (التسجيل بالدعوة فقط) يصل من Supabase Auth كخطأ حفظ عام
    if (error) return { error: "generic", message: /database error/i.test(error.message) ? tr("التسجيل بالدعوة فقط، اطلب من مدير النظام إنشاء حسابك") : undefined };
    if (!data.session) return { info: "check_email" };
    needsOnboarding = true;
  } catch {
    return { error: "generic" };
  }
  if (needsOnboarding) {
    redirect("/onboarding");
  }
  return null;
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
