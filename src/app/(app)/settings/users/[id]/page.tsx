import { notFound, redirect } from "next/navigation";
import Link from "@/components/link";
import { ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getAuthMode, usernamesOf } from "@/lib/supabase/local-auth";
import { raise } from "@/services/errors";
import { getI18n } from "@/i18n/server";
import { accessData } from "../access-data";
import { MemberAccessEditor } from "../users-client";

type Access = { role_ids: string[]; grants: string[]; denies: string[]; effective: string[]; home_path: string | null; limits: Record<string, number | null>; is_active: boolean };

export default async function MemberAccessPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.usersManage);
  const { id } = await params;
  if (id === ctx.user.id) redirect("/settings/users");
  const { t } = await getI18n();
  const [access, members, data] = await Promise.all([
    ctx.supabase.rpc("member_access", { p_hotel_id: ctx.hotel.id, p_user_id: id }),
    ctx.supabase.rpc("hotel_members_overview", { p_hotel_id: ctx.hotel.id }),
    accessData(ctx, t),
  ]);
  raise(access.error);
  if (!access.data) notFound();
  const a = access.data as unknown as Access;
  const member = (members.data ?? []).find((m) => m.user_id === id);
  const local = !isSupabaseConfigured();
  const username = local ? (await usernamesOf([id])).get(id) : member?.email;
  const name = member?.full_name || username || "موظف";
  // لا يدير المدير من يملك صلاحيات ليست عنده
  const above = a.effective.filter((c) => !ctx.permissions.has(c));

  return (
    <>
      <Link href="/settings/users" className="mb-3 inline-flex items-center gap-1 text-[15.5px] text-slate-500 hover:text-ink"><ChevronRight className="size-4" />المستخدمون والصلاحيات</Link>
      <PageHeader title={name} />
      {username && <p className="-mt-5 mb-6 text-[16px] text-slate-500" dir="ltr">{username}</p>}
      {above.length > 0 ? (
        <Alert variant="warning">هذا الموظف يملك صلاحيات ليست عندك، فلا يمكنك تعديل حسابه. يعدّله مدير يملك صلاحياته كلها.</Alert>
      ) : (
        <Card><CardContent className="pt-6">
          <MemberAccessEditor userId={id} name={name} local={local && (await getAuthMode()) === "multi"}
            roles={data.roles.map((r) => ({ id: r.id, label: r.name_ar }))} permissions={data.permissions} rolePermissions={data.rolePermissions}
            homeOptions={data.homeOptions}
            initial={{ role_ids: a.role_ids, grants: a.grants, denies: a.denies, home_path: a.home_path, limits: a.limits ?? {}, is_active: a.is_active }} />
        </CardContent></Card>
      )}
    </>
  );
}
