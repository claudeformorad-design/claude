"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  checkPassword, currentLocalUserId, getAuthMode, mustChangePassword, renewSession, setLocalPassword, signIn, signOut, strongPassword,
} from "@/lib/supabase/local-auth";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export type LocalAuthState = { error?: "invalid" | "locked" | "inactive" | "validation" | "weak" | "mismatch" | "current" } | null;

const userAgent = async () => (await headers()).get("user-agent")?.slice(0, 300) ?? null;

/** الدخول باسم المستخدم وكلمة المرور في التثبيت المحلي */
export async function localSignInAction(_prev: LocalAuthState, formData: FormData): Promise<LocalAuthState> {
  if (isSupabaseConfigured()) return { error: "validation" };
  const p = z.object({ username: z.string().trim().min(1).max(64), password: z.string().min(1).max(200) }).safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: "validation" };
  const r = await signIn(p.data.username, p.data.password, await userAgent());
  if (!r.ok) return { error: r.error };
  redirect(r.mustChange ? "/account/password" : "/?home=1");
}

export async function localSignOutAction(): Promise<void> {
  await signOut();
  redirect("/login");
}

/** تغيير كلمة المرور: إلزامي بعد أول دخول بكلمة مؤقتة، ومتاح لكل موظف لحسابه */
export async function changePasswordAction(_prev: LocalAuthState, formData: FormData): Promise<LocalAuthState> {
  if (isSupabaseConfigured() || (await getAuthMode()) !== "multi") return { error: "validation" };
  const userId = await currentLocalUserId();
  if (!userId) redirect("/login");
  const p = z.object({ current: z.string().max(200), password: z.string().max(200), confirm: z.string().max(200) }).safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: "validation" };
  // بعد كلمة مؤقتة من المدير لا نطلب الحالية؛ غير ذلك يجب إدخالها
  if (!(await mustChangePassword(userId)) && !(await checkPassword(userId, p.data.current))) return { error: "current" };
  if (p.data.password !== p.data.confirm) return { error: "mismatch" };
  if (!strongPassword(p.data.password)) return { error: "weak" };
  await setLocalPassword(userId, p.data.password, false);
  await renewSession(userId, await userAgent());
  redirect("/?home=1");
}
