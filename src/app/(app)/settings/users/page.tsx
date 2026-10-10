import { tr } from "@/i18n/tr";
import Link from "@/components/link";
import { ChevronLeft, Plus, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EntityCell } from "@/components/ui/entity";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { EDITION } from "@/lib/edition";
import { localName } from "@/lib/local-name";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { loginName } from "@/lib/auth/staff";
import { IDLE_MINUTES, getAuthMode, usernamesOf } from "@/lib/supabase/local-auth";
import { raise } from "@/services/errors";
import { AddEmployee, AddEmployeeByLink, EnableLogin } from "./users-client";

/**
 * المستخدمون والأدوار: قائمة الموظفين وأدوارهم، وتفعيل تسجيل الدخول في التثبيت المحلي، والأدوار وإعداداتها.
 * تفاصيل صلاحيات كل موظف في صفحته، وإعدادات كل دور في صفحته.
 */
export default async function UsersPage() {
  const ctx = await requireAppContext(PERMISSIONS.usersManage);
  const local = !isSupabaseConfigured();
  const mode = local ? await getAuthMode() : "multi";
  const [members, roles, links] = await Promise.all([
    ctx.supabase.rpc("hotel_members_overview", { p_hotel_id: ctx.hotel.id }),
    ctx.supabase.from("roles").select("id, code, name_ar, name_en, is_system").order("is_system", { ascending: false }).order("code"),
    local ? null : ctx.supabase.rpc("staff_link_status", { p_hotel_id: ctx.hotel.id }),
  ]);
  const joined = new Map((links?.data ?? []).map((l) => [l.user_id, l.joined]));
  raise(members.error);
  const roleRows = (roles.data ?? []).filter((r) => !EDITION.hiddenRoles.has(r.code));
  const roleName = new Map(roleRows.map((r) => [r.id, localName(r)]));
  const list = members.data ?? [];
  const usernames = local ? await usernamesOf(list.map((m) => m.user_id)) : new Map(list.map((m) => [m.user_id, loginName(m.email)]));
  const roleOptions = roleRows.map((r) => ({ id: r.id, label: localName(r) }));

  return (
    <>
      <PageHeader title={tr("المستخدمون والصلاحيات")} actions={
        <Button asChild variant="outline"><Link href="/approvals"><ShieldCheck className="size-4" />{tr("طلبات الموافقة")}</Link></Button>
      } />

      {local && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>{tr("تسجيل الدخول")}</CardTitle>
            <CardDescription>
              {mode === "single"
                ? tr("النظام الآن بدون تسجيل دخول، وكل من يفتحه يعمل بصلاحية المدير. فعّل تسجيل الدخول ليعمل كل موظف باسمه وصلاحياته من أي جهاز على شبكة الفندق.")
                : tr("تسجيل الدخول مفعّل. كل موظف يدخل باسمه، ويخرج تلقائيًا بعد {0} ساعات بلا استخدام.", IDLE_MINUTES / 60)}
            </CardDescription>
          </CardHeader>
          {mode === "single" && <CardContent><EnableLogin /></CardContent>}
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
        <Card className="overflow-hidden">
          <CardHeader><CardTitle className="justify-between"><span>{tr("الموظفون")}</span><span className="num font-medium text-slate-500">{list.length}</span></CardTitle></CardHeader>
          <Table>
            <TableHeader><TableRow><TableHead>{tr("الموظف")}</TableHead><TableHead>{tr("الوظيفة")}</TableHead><TableHead>{tr("الحالة")}</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {list.map((m) => {
                const self = m.user_id === ctx.user.id;
                const login = usernames.get(m.user_id) ?? (local ? "" : m.email);
                return (
                  <TableRow key={m.user_id}>
                    <TableCell className="cell-fluid"><EntityCell name={tr(m.full_name) || login || m.email} sub={login ? <span dir="ltr">{login}</span> : undefined}
                      href={self ? undefined : `/settings/users/${m.user_id}`} /></TableCell>
                    <TableCell className="text-slate-600">{m.role_ids.map((id) => roleName.get(id)).filter(Boolean).join(tr("، ")) || tr("بلا دور")}</TableCell>
                    <TableCell>{!m.is_active ? <Badge variant="secondary">{tr("موقوف")}</Badge>
                      : !self && joined.get(m.user_id) === false ? <Badge variant="warning">{tr("لم يدخل بعد")}</Badge>
                      : <Badge variant="success">{tr("نشط")}</Badge>}</TableCell>
                    <TableCell className="text-end">
                      {self ? <span className="text-[15px] text-slate-500">{tr("حسابك")}</span>
                        : <Link href={`/settings/users/${m.user_id}`} className="inline-flex items-center gap-1 font-medium text-action">{tr("إدارة")}<ChevronLeft className="size-4" /></Link>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {(!local || mode === "multi") && (
            <CardContent className="border-t border-line pt-5">
              {local ? <AddEmployee roles={roleOptions} /> : <AddEmployeeByLink roles={roleOptions} />}
            </CardContent>
          )}
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>{tr("الأدوار")}</CardTitle>
              <CardDescription>{tr("لكل دور صلاحياته وصفحته الأولى وإجراءاته السريعة وحدوده.")}</CardDescription>
            </div>
            <Button asChild size="sm" variant="outline"><Link href="/settings/users/roles/new"><Plus className="size-4" />{tr("دور جديد")}</Link></Button>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {roleRows.map((r) => (
              <Link key={r.id} href={`/settings/users/roles/${r.id}`}
                className="flex items-center justify-between rounded-[10px] px-3 py-2.5 transition-colors hover:bg-subtle">
                <span className="font-medium text-ink">{localName(r)}</span>
                <span className="flex items-center gap-2 text-[15px] text-slate-500">{r.is_system ? tr("دور أساسي") : tr("دور خاص")}<ChevronLeft className="size-4" /></span>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
