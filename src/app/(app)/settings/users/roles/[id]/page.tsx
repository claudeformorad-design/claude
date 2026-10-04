import { notFound } from "next/navigation";
import Link from "@/components/link";
import { ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PERMISSION_GROUPS } from "@/lib/auth/access-catalog";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { raise } from "@/services/errors";
import { getI18n } from "@/i18n/server";
import { accessData } from "../../access-data";
import { RolePermissionsEditor, RoleSettingsEditor } from "../../users-client";

export default async function RolePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.usersManage);
  const { id } = await params;
  const { t } = await getI18n();
  const data = await accessData(ctx, t);
  const isNew = id === "new";
  const role = isNew ? null : data.roles.find((r) => r.id === id);
  if (!isNew && !role) notFound();
  const settings = role ? await ctx.supabase.from("role_settings").select("*").eq("hotel_id", ctx.hotel.id).eq("role_id", role.id).maybeSingle() : null;
  if (settings) raise(settings.error);
  const perms = role ? data.rolePermissions[role.id] ?? [] : [];
  // تجميع يدوي: يعمل على Node 20 (Object.groupBy من Node 21)
  const grouped: [string, typeof data.permissions][] = [];
  for (const p of data.permissions.filter((x) => perms.includes(x.code))) {
    const g = grouped.find(([m]) => m === p.module);
    if (g) g[1].push(p); else grouped.push([p.module, [p]]);
  }

  return (
    <>
      <Link href="/settings/users" className="mb-3 inline-flex items-center gap-1 text-[15.5px] text-slate-500 hover:text-ink"><ChevronRight className="size-4" />المستخدمون والصلاحيات</Link>
      <PageHeader title={isNew ? "دور جديد" : role!.name_ar} />
      <div className="space-y-6">
        {role && (
          <Card>
            <CardHeader>
              <CardTitle>الواجهة والحدود</CardTitle>
              <CardDescription>ما يراه كل من يحمل هذا الدور في هذا الفندق عند دخوله.</CardDescription>
            </CardHeader>
            <CardContent>
              <RoleSettingsEditor roleId={role.id} homeOptions={data.homeOptions} quickOptions={data.quickOptions}
                initial={{
                  home_path: settings?.data?.home_path ?? null, quick_actions: settings?.data?.quick_actions ?? [],
                  dashboard_hidden: settings?.data?.dashboard_hidden ?? [], limits: settings?.data?.limits ?? {},
                }} />
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle>الصلاحيات</CardTitle>
            <CardDescription>{role?.is_system
              ? "صلاحيات الأدوار الأساسية ثابتة. لتغييرها أنشئ دورًا خاصًا، أو امنح وامنع لكل موظف من صفحته."
              : "لا يمكنك إضافة صلاحية لا تملكها أنت، ولا تعديل دور تحمله بنفسك."}</CardDescription>
          </CardHeader>
          <CardContent>
            {role?.is_system ? (
              <div className="grid gap-4 lg:grid-cols-2">
                {grouped.map(([module, items]) => (
                  <div key={module} className="rounded-xl border border-line">
                    <p className="border-b border-line bg-panel px-4 py-2.5 font-semibold text-ink">{PERMISSION_GROUPS[module] ?? module}</p>
                    <ul className="divide-y divide-line">{(items ?? []).map((p) => <li key={p.code} className="px-4 py-2.5 text-[15.5px] text-ink">{p.label}</li>)}</ul>
                  </div>
                ))}
                {grouped.length === 0 && <p className="text-slate-500">لا صلاحيات لهذا الدور في هذه النسخة.</p>}
              </div>
            ) : (
              <RolePermissionsEditor key={id} permissions={data.permissions} held={[...ctx.permissions]}
                role={role ? { id: role.id, code: role.code, name_ar: role.name_ar, name_en: role.name_en, permissions: perms } : { code: "", name_ar: "", name_en: "", permissions: [] }} />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
