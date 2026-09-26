import { Suspense } from "react";
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
  const roleLabel = ctx.can(PERMISSIONS.hotelManage) ? "مدير الفندق" : ctx.can(PERMISSIONS.journalCreate) ? "محاسب" : "مستخدم";

  return (
    <div className="h-screen p-0 md:p-5 xl:p-7">
      <Suspense fallback={null}>
        <RouteProgress />
      </Suspense>
      <PointerEffects />
      <div className="app-frame flex h-full flex-col overflow-hidden md:rounded-[30px]">
        <TopBar
          labels={t.nav}
          hotelName={hotelName}
          userName={ctx.profile?.full_name ?? ""}
          userEmail={ctx.user.email ?? ""}
          roleLabel={roleLabel}
          signOut={isSupabaseConfigured() ? signOutAction : undefined}
        />
        <div className="flex min-h-0 flex-1">
          <Sidebar labels={t.nav} />
          <main className="min-w-0 flex-1 overflow-y-auto px-4 pb-10 pt-2 md:pe-2 md:ps-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
