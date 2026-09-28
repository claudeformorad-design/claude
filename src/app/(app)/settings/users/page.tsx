import Link from "@/components/link";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { raise } from "@/services/errors";
import { getI18n } from "@/i18n/server";
import { addMemberAction } from "../../_admin/actions";
import { SimpleForm } from "../../_assets/simple-form";
import { MemberRow, RoleEditor } from "./users-client";

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.usersManage);
  const { locale, t } = await getI18n();
  const sp = await searchParams;
  const [members, roles, perms, rolePerms] = await Promise.all([
    ctx.supabase.rpc("hotel_members_overview", { p_hotel_id: ctx.hotel.id }),
    ctx.supabase.from("roles").select("*").order("is_system", { ascending: false }).order("code"),
    ctx.supabase.from("permissions").select("*").order("sort_order"),
    ctx.supabase.from("role_permissions").select("role_id, permission_code"),
  ]);
  raise(members.error);
  const label = (x: { name_ar: string; name_en: string }) => (locale === "en" ? x.name_en : x.name_ar);
  const roleList = (roles.data ?? []).map((r) => ({ id: r.id, label: label(r), system: r.is_system }));
  const a = t.admin;
  const editing: { id?: string; code: string; name_ar: string; name_en: string; permissions: string[] } | null = sp.role === "new" ? { code: "", name_ar: "", name_en: "", permissions: [] }
    : (() => {
        const r = (roles.data ?? []).find((x) => x.id === sp.role && !x.is_system);
        return r ? { id: r.id, code: r.code, name_ar: r.name_ar, name_en: r.name_en, permissions: (rolePerms.data ?? []).filter((p) => p.role_id === r.id).map((p) => p.permission_code) } : null;
      })();

  return (
    <>
      <PageHeader title={t.nav.users} />
      <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
        <Card className="overflow-hidden">
          <CardHeader><CardTitle>{a.roles}</CardTitle></CardHeader>
          {(members.data ?? []).map((m) => (
            <MemberRow key={m.user_id} t={{ admin: a, common: t.common, errors: t.errors }} userId={m.user_id} email={m.email} name={m.full_name}
              active={m.is_active} roleIds={m.role_ids} roles={roleList} isSelf={m.user_id === ctx.user.id} />
          ))}
          <CardContent className="border-t pt-4">
            <SimpleForm columns={2} submitLabel={a.addUser} errors={t.errors} action={addMemberAction}
              initial={{ email: "", role_id: "" }}
              fields={[{ name: "email", label: a.email_, ltr: true }, { name: "role_id", label: a.roles, options: roleList }]} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>{a.customRoles}</CardTitle>
            <Button asChild size="sm" variant="outline"><Link href="/settings/users?role=new">{a.newRole}</Link></Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {(roles.data ?? []).filter((r) => !r.is_system).map((r) => (
              <Link key={r.id} href={`/settings/users?role=${r.id}`} className="block rounded-[10px] bg-panel p-3 hover:bg-subtle">{label(r)} <span className="text-xs text-muted-foreground num">{r.code}</span></Link>
            ))}
          </CardContent>
        </Card>
      </div>
      {editing && (
        <Card className="mt-6"><CardHeader><CardTitle>{editing.id ? t.common.edit : a.newRole}، {a.permissions}</CardTitle></CardHeader><CardContent>
          <RoleEditor key={sp.role} t={{ admin: a, common: t.common, errors: t.errors }} role={editing}
            permissions={(perms.data ?? []).map((p) => ({ code: p.code, module: p.module, label: locale === "en" ? p.name_en : p.name_ar }))} />
        </CardContent></Card>
      )}
    </>
  );
}
