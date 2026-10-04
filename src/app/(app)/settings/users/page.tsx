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
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { IDLE_MINUTES, getAuthMode, usernamesOf } from "@/lib/supabase/local-auth";
import { raise } from "@/services/errors";
import { AddEmployee, EnableLogin } from "./users-client";

/**
 * المستخدمون والأدوار: قائمة الموظفين وأدوارهم، وتفعيل تسجيل الدخول في التثبيت المحلي، والأدوار وإعداداتها.
 * تفاصيل صلاحيات كل موظف في صفحته، وإعدادات كل دور في صفحته.
 */
export default async function UsersPage() {
  const ctx = await requireAppContext(PERMISSIONS.usersManage);
  const local = !isSupabaseConfigured();
  const mode = local ? await getAuthMode() : "multi";
  const [members, roles] = await Promise.all([
    ctx.supabase.rpc("hotel_members_overview", { p_hotel_id: ctx.hotel.id }),
    ctx.supabase.from("roles").select("id, code, name_ar, is_system").order("is_system", { ascending: false }).order("code"),
  ]);
  raise(members.error);
  const roleRows = (roles.data ?? []).filter((r) => !EDITION.hiddenRoles.has(r.code));
  const roleName = new Map(roleRows.map((r) => [r.id, r.name_ar]));
  const list = members.data ?? [];
  const usernames = local ? await usernamesOf(list.map((m) => m.user_id)) : new Map<string, string>();
  const roleOptions = roleRows.map((r) => ({ id: r.id, label: r.name_ar }));

  return (
    <>
      <PageHeader title="المستخدمون والصلاحيات" actions={
        <Button asChild variant="outline"><Link href="/approvals"><ShieldCheck className="size-4" />طلبات الموافقة</Link></Button>
      } />

      {local && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>تسجيل الدخول</CardTitle>
            <CardDescription>
              {mode === "single"
                ? "النظام الآن بدون تسجيل دخول، وكل من يفتحه يعمل بصلاحية المدير. فعّل تسجيل الدخول ليعمل كل موظف باسمه وصلاحياته من أي جهاز على شبكة الفندق."
                : `تسجيل الدخول مفعّل. كل موظف يدخل باسمه، ويخرج تلقائيًا بعد ${IDLE_MINUTES / 60} ساعات بلا استخدام.`}
            </CardDescription>
          </CardHeader>
          {mode === "single" && <CardContent><EnableLogin /></CardContent>}
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
        <Card className="overflow-hidden">
          <CardHeader><CardTitle className="justify-between"><span>الموظفون</span><span className="num font-medium text-slate-500">{list.length}</span></CardTitle></CardHeader>
          <Table>
            <TableHeader><TableRow><TableHead>الموظف</TableHead><TableHead>الأدوار</TableHead><TableHead>الحالة</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {list.map((m) => {
                const self = m.user_id === ctx.user.id;
                const login = usernames.get(m.user_id) ?? (local ? "" : m.email);
                return (
                  <TableRow key={m.user_id}>
                    <TableCell className="cell-fluid"><EntityCell name={m.full_name || login || m.email} sub={login ? <span dir="ltr">{login}</span> : undefined}
                      href={self ? undefined : `/settings/users/${m.user_id}`} /></TableCell>
                    <TableCell className="text-slate-600">{m.role_ids.map((id) => roleName.get(id)).filter(Boolean).join("، ") || "بلا دور"}</TableCell>
                    <TableCell>{m.is_active ? <Badge variant="success">نشط</Badge> : <Badge variant="secondary">موقوف</Badge>}</TableCell>
                    <TableCell className="text-end">
                      {self ? <span className="text-[15px] text-slate-500">حسابك</span>
                        : <Link href={`/settings/users/${m.user_id}`} className="inline-flex items-center gap-1 font-medium text-action">الصلاحيات<ChevronLeft className="size-4" /></Link>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {(!local || mode === "multi") && (
            <CardContent className="border-t border-line pt-5">
              <AddEmployee local={local} roles={roleOptions} />
            </CardContent>
          )}
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>الأدوار</CardTitle>
              <CardDescription>لكل دور صلاحياته وصفحته الأولى وإجراءاته السريعة وحدوده.</CardDescription>
            </div>
            <Button asChild size="sm" variant="outline"><Link href="/settings/users/roles/new"><Plus className="size-4" />دور جديد</Link></Button>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {roleRows.map((r) => (
              <Link key={r.id} href={`/settings/users/roles/${r.id}`}
                className="flex items-center justify-between rounded-[10px] px-3 py-2.5 transition-colors hover:bg-subtle">
                <span className="font-medium text-ink">{r.name_ar}</span>
                <span className="flex items-center gap-2 text-[15px] text-slate-500">{r.is_system ? "دور أساسي" : "دور خاص"}<ChevronLeft className="size-4" /></span>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
