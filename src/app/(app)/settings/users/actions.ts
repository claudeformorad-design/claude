"use server";
import { tr } from "@/i18n/tr";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { DASHBOARD_SECTIONS, LIMITS, QUICK_ACTIONS } from "@/lib/auth/access-catalog";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  USERNAME_RE, createLocalAccount, discardLocalAccount, enableMultiUser, endSessionsOf, getAuthMode, normalizeUsername, setLocalPassword,
  strongPassword, usernameTaken,
} from "@/lib/supabase/local-auth";
import type { Json } from "@/lib/supabase/database.types";
import { type ActionResult, raise, toActionResult } from "@/services/errors";

const fail = { ok: false as const, error: "validation" as const };
const msg = (message: string) => ({ ok: false as const, error: "unknown" as const, message });
const path = z.string().trim().regex(/^\/[a-z0-9/_-]*$/).max(80).nullable().optional();
const limitsSchema = z.object(Object.fromEntries(LIMITS.map((l) => [l.key, z.number().min(0).max(l.percent ? 100 : 1e12).nullable().optional()])));
const userAgent = async () => (await headers()).get("user-agent")?.slice(0, 300) ?? null;

/** يحذف المفاتيح الفارغة: الحد غير المحدد يعني «حسب الدور» للموظف، و«بلا حد» للدور */
const cleanLimits = (v: Record<string, number | null | undefined>) =>
  Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined && x !== null)) as Json;

/** تفعيل تسجيل الدخول لعدة موظفين في التثبيت المحلي */
export async function enableLoginAction(input: unknown): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.usersManage);
  if (isSupabaseConfigured() || (await getAuthMode()) === "multi") return fail;
  const p = z.object({ username: z.string(), password: z.string().max(200), confirm: z.string().max(200) }).safeParse(input);
  if (!p.success) return fail;
  const username = normalizeUsername(p.data.username);
  if (!USERNAME_RE.test(username)) return msg(tr("اسم المستخدم من 3 إلى 32 حرفًا إنجليزيًا صغيرًا أو رقمًا"));
  if (p.data.password !== p.data.confirm) return msg(tr("كلمتا المرور غير متطابقتين"));
  if (!strongPassword(p.data.password)) return msg(tr("كلمة المرور 8 أحرف على الأقل، وفيها حرف ورقم"));
  if (await usernameTaken(username, ctx.user.id)) return msg(tr("اسم المستخدم مستخدم لحساب آخر"));
  await enableMultiUser(username, p.data.password, await userAgent());
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

/** إضافة موظف: في التثبيت المحلي باسم دخول وكلمة مرور مؤقتة، ومع Supabase ببريد مسجّل */
export async function addEmployeeAction(input: unknown): Promise<ActionResult<string>> {
  const ctx = await requireAppContext(PERMISSIONS.usersManage);
  const p = z.object({
    full_name: z.string().trim().min(2).max(120).optional(), username: z.string().optional(), email: z.string().optional(),
    password: z.string().max(200).optional(), role_id: z.uuid(),
  }).safeParse(input);
  if (!p.success) return fail;
  const v = p.data;
  if (isSupabaseConfigured()) {
    if (!z.email().safeParse(v.email).success) return fail;
    const r = await toActionResult(async () => {
      const { data, error } = await ctx.supabase.rpc("add_hotel_member", { p_hotel_id: ctx.hotel.id, p_email: v.email!, p_role_ids: [v.role_id] });
      raise(error);
      return data!;
    });
    if (r.ok) revalidatePath("/settings/users");
    return r;
  }
  if ((await getAuthMode()) !== "multi") return msg(tr("فعّل تسجيل الدخول أولًا من أعلى الصفحة"));
  const username = normalizeUsername(v.username ?? "");
  if (!v.full_name) return msg(tr("اكتب اسم الموظف"));
  if (!USERNAME_RE.test(username)) return msg(tr("اسم المستخدم من 3 إلى 32 حرفًا إنجليزيًا صغيرًا أو رقمًا"));
  if (!strongPassword(v.password ?? "")) return msg(tr("كلمة المرور المؤقتة 8 أحرف على الأقل، وفيها حرف ورقم"));
  if (await usernameTaken(username)) return msg(tr("اسم المستخدم مستخدم لحساب آخر"));
  const account = await createLocalAccount(v.full_name, username, v.password!);
  // الربط بالفندق يتم بهوية المدير، فتطبَّق حراسة قاعدة البيانات: لا يمنح دورًا أعلى من صلاحياته
  const r = await toActionResult(async () => {
    const { error } = await ctx.supabase.rpc("add_hotel_member", { p_hotel_id: ctx.hotel.id, p_email: account.email, p_role_ids: [v.role_id] });
    raise(error);
    return account.userId;
  });
  if (!r.ok) await discardLocalAccount(account.userId);
  else revalidatePath("/settings/users");
  return r;
}

/** حفظ صلاحيات موظف دفعة واحدة */
export async function saveMemberAccessAction(userId: string, input: unknown): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.usersManage);
  const p = z.object({
    role_ids: z.array(z.uuid()).max(20), grants: z.array(z.string().max(80)).max(200), denies: z.array(z.string().max(80)).max(200),
    home_path: path, limits: limitsSchema, is_active: z.boolean(),
  }).safeParse(input);
  if (!z.uuid().safeParse(userId).success || !p.success) return fail;
  const v = p.data;
  const r = await toActionResult(async () => {
    const { error } = await ctx.supabase.rpc("set_member_access", {
      p_hotel_id: ctx.hotel.id, p_user_id: userId, p_role_ids: v.role_ids, p_grants: v.grants, p_denies: v.denies,
      p_home_path: v.home_path ?? null, p_limits: cleanLimits(v.limits), p_is_active: v.is_active,
    });
    raise(error);
    return undefined;
  });
  if (r.ok) {
    // الحساب الموقوف يخرج من كل أجهزته فورًا
    if (!v.is_active && !isSupabaseConfigured()) await endSessionsOf(userId);
    revalidatePath("/settings/users", "layout");
  }
  return r;
}

/** يتحقق أن المنفّذ يدير هذا الموظف: ليس هو نفسه، وكل صلاحيات الموظف ضمن صلاحياته */
async function canManage(ctx: Awaited<ReturnType<typeof requireAppContext>>, userId: string): Promise<string | null> {
  if (userId === ctx.user.id) return tr("لا يمكنك إدارة حسابك من هنا");
  const { data, error } = await ctx.supabase.rpc("member_access", { p_hotel_id: ctx.hotel.id, p_user_id: userId });
  if (error || !data) return tr("الموظف غير موجود في هذا الفندق");
  const effective = ((data as { effective?: string[] }).effective ?? []);
  if (effective.some((c) => !ctx.permissions.has(c))) return tr("لا يمكنك إدارة موظف يملك صلاحيات ليست عندك");
  return null;
}

/** المدير يعيّن كلمة مرور مؤقتة لموظف، فيغيّرها الموظف عند دخوله */
export async function resetPasswordAction(userId: string, password: string): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.usersManage);
  if (isSupabaseConfigured() || (await getAuthMode()) !== "multi" || !z.uuid().safeParse(userId).success) return fail;
  const denied = await canManage(ctx, userId);
  if (denied) return msg(denied);
  if (!strongPassword(password)) return msg(tr("كلمة المرور المؤقتة 8 أحرف على الأقل، وفيها حرف ورقم"));
  await setLocalPassword(userId, password, true);
  return { ok: true, data: undefined };
}

/** إخراج الموظف من كل الأجهزة */
export async function endSessionsAction(userId: string): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.usersManage);
  if (isSupabaseConfigured() || !z.uuid().safeParse(userId).success) return fail;
  const denied = await canManage(ctx, userId);
  if (denied) return msg(denied);
  await endSessionsOf(userId);
  return { ok: true, data: undefined };
}

/** إعدادات الدور في هذا الفندق: الصفحة الأولى، الإجراءات السريعة، أقسام اللوحة المخفية، والحدود */
export async function saveRoleSettingsAction(roleId: string, input: unknown): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.usersManage);
  const quick = new Set(QUICK_ACTIONS.map((q) => q.key));
  const sections = new Set(DASHBOARD_SECTIONS.map((d) => d.key));
  const p = z.object({
    home_path: path, quick_actions: z.array(z.string()).max(12).refine((a) => a.every((x) => quick.has(x))),
    dashboard_hidden: z.array(z.string()).max(12).refine((a) => a.every((x) => sections.has(x))), limits: limitsSchema,
  }).safeParse(input);
  if (!z.uuid().safeParse(roleId).success || !p.success) return fail;
  const v = p.data;
  const r = await toActionResult(async () => {
    const row = {
      hotel_id: ctx.hotel.id, role_id: roleId, home_path: v.home_path ?? null, quick_actions: v.quick_actions,
      dashboard_hidden: v.dashboard_hidden, limits: cleanLimits(v.limits) as Record<string, number | null>, updated_at: new Date().toISOString(),
    };
    const existing = await ctx.supabase.from("role_settings").select("role_id").eq("hotel_id", ctx.hotel.id).eq("role_id", roleId).maybeSingle();
    raise(existing.error);
    const res = existing.data
      ? await ctx.supabase.from("role_settings").update(row).eq("hotel_id", ctx.hotel.id).eq("role_id", roleId)
      : await ctx.supabase.from("role_settings").insert(row);
    raise(res.error);
    return undefined;
  });
  if (r.ok) revalidatePath("/", "layout");
  return r;
}
