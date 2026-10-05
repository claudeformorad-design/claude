"use server";

import { redirect } from "next/navigation";
import { tr } from "@/i18n/tr";
import { STAFF_DOMAIN } from "@/lib/auth/staff";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { applyPreferredLocale } from "../locale-actions";

export type AuthState = { error?: "invalid" | "validation" | "generic"; info?: "check_email"; message?: string } | null;


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

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/** يفتح جلسة على هذا الجهاز بالكلمة العشوائية التي أصدرتها قاعدة البيانات لمرة واحدة (لا تصل للمتصفح أبدًا) */
async function signInIssued(login: { email?: string; password?: string } | null): Promise<boolean> {
  if (!login?.email || !login.password) return false;
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: login.email, password: login.password });
  return !error;
}

/** «ابدأ» على النظام الجديد: يصبح هذا الجهاز جهاز صاحب النظام */
export async function claimOwnerAction(): Promise<AuthState> {
  const { anonRpc } = await import("@/lib/supabase/public-rpc");
  const { data, error } = await anonRpc<{ email: string; password: string }>("claim_owner", {});
  if (error || !(await signInIssued(data))) {
    const { describeDatabaseError } = await import("@/lib/accounting/errors");
    return { error: "generic", message: (error && describeDatabaseError(error.message)) || tr("تعذر البدء، حدّث الصفحة وحاول مرة أخرى") };
  }
  // أول دخول: تعريف قصير بالنظام، ثم إعداد الفندق
  redirect("/welcome");
}

/** رابط دخول الموظف: يُستخدم مرة واحدة ويسجّل دخوله على جهازه */
export async function redeemLinkAction(token: string): Promise<AuthState> {
  if (!/^[0-9a-f]{64}$/.test(token)) return { error: "generic", message: tr("رابط الدخول غير صالح: استُخدم من قبل أو انتهت مدته، اطلب رابطًا جديدًا من المدير") };
  const { anonRpc } = await import("@/lib/supabase/public-rpc");
  const { data, error } = await anonRpc<{ email: string; password: string }>("redeem_access_link", { p_token: token });
  if (error || !(await signInIssued(data))) {
    const { describeDatabaseError } = await import("@/lib/accounting/errors");
    return { error: "generic", message: (error && describeDatabaseError(error.message)) || tr("تعذر الدخول، حاول مرة أخرى") };
  }
  redirect("/?home=1");
}
