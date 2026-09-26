import { Suspense } from "react";
import { cookies } from "next/headers";
import { SIDEBAR_COOKIE } from "@/components/layout/nav-config";
import { PointerEffects } from "@/components/layout/pointer-effects";
import { RouteProgress } from "@/components/layout/route-progress";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getI18n } from "@/i18n/server";
import { signOutAction } from "../login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAppContext();
  const { t } = await getI18n();
  const hotelName = ctx.hotel.name_ar || ctx.hotel.name_en || "";
  // وصف الدور من الصلاحيات الفعلية (بدون افتراض)
  const sidebarExpanded = (await cookies()).get(SIDEBAR_COOKIE)?.value === "1";
  const roleLabel = ctx.can(PERMISSIONS.hotelManage) ? "مدير الفندق" : ctx.can(PERMISSIONS.journalCreate) ? "محاسب" : "مستخدم";

  const signOut = isSupabaseConfigured() ? signOutAction : undefined;

  return (
    // الخلفية الخارجية بيج دافئ، والواجهة فوقها بملء الشاشة تقريبًا
    <div className="flex h-screen bg-frame md:p-2.5">
      <Suspense fallback={null}>
        <RouteProgress />
      </Suspense>
      <PointerEffects />
      <div className="flex min-w-0 flex-1 overflow-hidden bg-content md:rounded-[20px] md:shadow-soft">
        <Sidebar
          labels={t.nav}
          hotelName={hotelName}
          user={{ name: ctx.profile?.full_name ?? "", email: ctx.user.email ?? "", role: roleLabel, signOut }}
          initialExpanded={sidebarExpanded}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar
            labels={t.nav}
            hotelName={hotelName}
            userName={ctx.profile?.full_name ?? ""}
            userEmail={ctx.user.email ?? ""}
            roleLabel={roleLabel}
            signOut={signOut}
          />
          <main className="min-w-0 flex-1 overflow-y-auto px-4 pb-12 pt-1 md:px-10">{children}</main>
        </div>
      </div>
    </div>
  );
}
