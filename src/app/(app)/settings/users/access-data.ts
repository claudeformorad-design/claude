import "server-only";
import type { AppContext } from "@/lib/auth/context";
import { QUICK_ACTIONS } from "@/lib/auth/access-catalog";
import { navGroups } from "@/components/layout/nav-config";
import { EDITION } from "@/lib/edition";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import { raise } from "@/services/errors";

/** بيانات مشتركة لشاشات الصلاحيات: الصلاحيات المعروضة في هذه النسخة، والأدوار، وصفحات البداية، والإجراءات السريعة */
export async function accessData(ctx: AppContext, t: Dictionary) {
  const modules = ctx.hotel.enabled_modules ?? ["accounting", "pms"];
  const [roles, perms, rolePerms] = await Promise.all([
    ctx.supabase.from("roles").select("id, code, name_ar, name_en, is_system").order("is_system", { ascending: false }).order("code"),
    ctx.supabase.from("permissions").select("code, module, name_ar, product, sort_order").order("sort_order"),
    ctx.supabase.from("role_permissions").select("role_id, permission_code"),
  ]);
  raise(roles.error); raise(perms.error); raise(rolePerms.error);
  const permissionRows = ((perms.data ?? []) as unknown as { code: string; module: string; name_ar: string; product: string }[])
    .filter((p) => (p.product === "core" || modules.includes(p.product as "accounting" | "pms")) && !EDITION.hiddenModules.has(p.module));
  const visible = new Set(permissionRows.map((p) => p.code));
  const roleRows = (roles.data ?? []).filter((r) => !EDITION.hiddenRoles.has(r.code));
  const rolePermissions: Record<string, string[]> = {};
  for (const rp of rolePerms.data ?? []) if (visible.has(rp.permission_code)) (rolePermissions[rp.role_id] ??= []).push(rp.permission_code);
  // صفحات البداية: كل صفحة في القائمة لهذه النسخة والأقسام المفعّلة
  const homeOptions = navGroups(t.nav, { modules, permissions: [...visible] })
    .flatMap((g) => g.items.map((i) => ({ href: i.href, label: g.title && g.items.length > 1 ? `${g.title}، ${i.label}` : i.label })))
    .filter((o, i, a) => a.findIndex((x) => x.href === o.href) === i);
  const quickOptions = QUICK_ACTIONS
    .filter((q) => visible.has(q.permission) && !EDITION.hiddenQuickActions.has(q.key))
    .map(({ key, label }) => ({ key, label }));
  return {
    roles: roleRows,
    permissions: permissionRows.map((p) => ({ code: p.code, module: p.module, label: p.name_ar })),
    rolePermissions, homeOptions, quickOptions,
  };
}
