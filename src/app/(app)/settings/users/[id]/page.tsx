import { tr } from "@/i18n/tr";
import { notFound, redirect } from "next/navigation";
import Link from "@/components/link";
import { ChevronRight } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { loginName } from "@/lib/auth/staff";
import { getAuthMode, usernamesOf } from "@/lib/supabase/local-auth";
import { raise } from "@/services/errors";
import { getI18n } from "@/i18n/server";
import { accessData } from "../access-data";
import { MemberAccessEditor, StaffAccountPanel } from "../users-client";

type Access = { role_ids: string[]; grants: string[]; denies: string[]; effective: string[]; home_path: string | null; limits: Record<string, number | null>; is_active: boolean };

/** صفحة الموظف: حالته وأزرار حسابه في الأعلى، ثم وظيفته، ثم ما يستطيع فعله بمفاتيح تشغيل وإيقاف */
export default async function MemberAccessPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.usersManage);
  const { id } = await params;
  if (id === ctx.user.id) redirect("/settings/users");
  const { t } = await getI18n();
  const local = !isSupabaseConfigured();
  const [access, members, data, links] = await Promise.all([
    ctx.supabase.rpc("member_access", { p_hotel_id: ctx.hotel.id, p_user_id: id }),
    ctx.supabase.rpc("hotel_members_overview", { p_hotel_id: ctx.hotel.id }),
    accessData(ctx, t),
    local ? null : ctx.supabase.rpc("staff_link_status", { p_hotel_id: ctx.hotel.id }),
  ]);
  raise(access.error);
  if (!access.data) notFound();
  const a = access.data as unknown as Access;
  const member = (members.data ?? []).find((m) => m.user_id === id);
  const username = local ? (await usernamesOf([id])).get(id) : loginName(member?.email);
  const name = member?.full_name || username || tr("موظف");
  const link = links?.data?.find((l) => l.user_id === id);
  // لا يدير المدير من يملك صلاحيات ليست عنده
  const above = a.effective.filter((c) => !ctx.permissions.has(c));

  return (
    <>
      <Link href="/settings/users" className="mb-3 inline-flex items-center gap-1 text-[15.5px] text-slate-500 hover:text-ink"><ChevronRight className="size-4" />{tr("المستخدمون والصلاحيات")}</Link>
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <span className="grid size-14 shrink-0 place-items-center rounded-full bg-ink text-[22px] font-semibold text-white">{name.trim().charAt(0)}</span>
        <div>
          <h1 className="text-[26px] font-bold text-ink">{name}</h1>
          {username && <p className="text-[15.5px] text-slate-500"><span dir="ltr">{username}</span></p>}
        </div>
      </div>
      {above.length > 0 ? (
        <Alert variant="warning">{tr("هذا الموظف يملك صلاحيات ليست عندك، فلا يمكنك تعديل حسابه. يعدّله مدير يملك صلاحياته كلها.")}</Alert>
      ) : (
        <div className="space-y-6">
          <StaffAccountPanel userId={id} name={name} isActive={a.is_active} linkMode={!local} local={local && (await getAuthMode()) === "multi"}
            joined={link?.joined ?? true} linkExpiresAt={link?.link_expires_at ?? null} />
          <MemberAccessEditor userId={id} name={name} isActive={a.is_active}
            roles={data.roles.map((r) => ({ id: r.id, label: r.label }))} permissions={data.permissions} rolePermissions={data.rolePermissions}
            homeOptions={data.homeOptions}
            initial={{ role_ids: a.role_ids, grants: a.grants, denies: a.denies, home_path: a.home_path, limits: a.limits ?? {} }} />
        </div>
      )}
    </>
  );
}
