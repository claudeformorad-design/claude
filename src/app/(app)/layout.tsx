import { Suspense } from "react";
import { cookies } from "next/headers";
import { SIDEBAR_COOKIE } from "@/components/layout/nav-config";
import { PointerEffects } from "@/components/layout/pointer-effects";
import { RouteProgress } from "@/components/layout/route-progress";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { Toaster } from "@/components/ui/toast";
import { HoverPrefetch } from "@/components/layout/hover-prefetch";
import { PageFrame } from "@/components/layout/page-frame";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isDemoDataActive } from "@/lib/supabase/local-db";
import { getI18n } from "@/i18n/server";
import { signOutAction } from "../login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAppContext();
  const { t } = await getI18n();
  const hotelName = ctx.hotel.name_ar || ctx.hotel.name_en || "";
  // وصف الدور من الصلاحيات الفعلية (بدون افتراض)
  const sidebarExpanded = (await cookies()).get(SIDEBAR_COOKIE)?.value === "1";
  const roleLabel = ctx.can(PERMISSIONS.hotelManage) ? "مدير الفندق" : ctx.can(PERMISSIONS.journalCreate) ? "محاسب"
    : ctx.can(PERMISSIONS.pmsManage) ? "موظف استقبال" : "مستخدم";

  const signOut = isSupabaseConfigured() ? signOutAction : undefined;
  // ما يظهر في التنقل: الأقسام المفعّلة للفندق وصلاحيات المستخدم فيه
  const access = { modules: ctx.hotel.enabled_modules ?? ["accounting", "pms"], permissions: [...ctx.permissions].sort() };

  return (
    // ملء الشاشة بلا حدود في الأطراف
    <div className="flex h-screen bg-content">
      <Suspense fallback={null}>
        <RouteProgress />
      </Suspense>
      <PointerEffects />
      <Toaster />
      <HoverPrefetch />
      <div className="flex min-w-0 flex-1 overflow-hidden">
        <Sidebar
          labels={t.nav}
          access={access}
          hotelName={hotelName}
          signOut={signOut}
          initialExpanded={sidebarExpanded}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar
            labels={t.nav}
            access={access}
            hotelName={hotelName}
            userName={ctx.profile?.full_name ?? ""}
            userEmail={ctx.user.email ?? ""}
            roleLabel={roleLabel}
            signOut={signOut}
            demo={!isSupabaseConfigured() && isDemoDataActive()}
          />
          <main className="min-w-0 flex-1 overflow-y-auto px-4 pb-12 pt-1 md:px-10"><PageFrame>{children}</PageFrame></main>
        </div>
      </div>
    </div>
  );
}
