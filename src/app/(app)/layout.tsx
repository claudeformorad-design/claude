import { currentLocale, tr } from "@/i18n/tr";
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
import { assistantConfig } from "@/lib/assistant/provider";
import { isDemoDataActive } from "@/lib/supabase/local-db";
import { getI18n } from "@/i18n/server";
import { redirect } from "next/navigation";
import { signOutAction } from "../login/actions";
import { localSignOutAction } from "../login/local-actions";
import { getAuthMode, mustChangePassword, usernamesOf } from "@/lib/supabase/local-auth";
import { QUICK_ACTIONS } from "@/lib/auth/access-catalog";
import { EDITION } from "@/lib/edition";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAppContext();
  const { t } = await getI18n();
  const hotelName = (currentLocale() === "en" && ctx.hotel.name_en) || ctx.hotel.name_ar || ctx.hotel.name_en || "";
  // وصف الدور من الصلاحيات الفعلية (بدون افتراض)
  const sidebarExpanded = (await cookies()).get(SIDEBAR_COOKIE)?.value === "1";
  const roleLabel = ctx.can(PERMISSIONS.hotelManage) ? tr("مدير الفندق") : ctx.can(PERMISSIONS.journalCreate) ? tr("محاسب")
    : ctx.can(PERMISSIONS.pmsManage) ? tr("موظف استقبال") : tr("مستخدم");

  // التثبيت المحلي بعدة مستخدمين: زر خروج، وإلزام تغيير كلمة المرور المؤقتة قبل أي صفحة
  const localMulti = !isSupabaseConfigured() && (await getAuthMode()) === "multi";
  if (localMulti && (await mustChangePassword(ctx.user.id))) redirect("/account/password");
  const signOut = isSupabaseConfigured() ? signOutAction : localMulti ? localSignOutAction : undefined;
  // ما يظهر في التنقل: الأقسام المفعّلة للفندق وصلاحيات المستخدم فيه
  const access = { modules: ctx.hotel.enabled_modules ?? ["accounting", "pms"], permissions: [...ctx.permissions].sort() };
  // الإجراءات السريعة: ما اختاره المدير لدور الموظف، وإن لم يختر شيئًا فكل ما تسمح به صلاحياته
  const quickAllowed = QUICK_ACTIONS.filter((q) => ctx.can(q.permission) && !EDITION.hiddenQuickActions.has(q.key)
    && (q.module === "core" || access.modules.includes(q.module)));
  const chosen = quickAllowed.filter((q) => ctx.ui.quick_actions.includes(q.key));
  const quickActions = (ctx.ui.quick_actions.length ? chosen : quickAllowed).map(({ href, label }) => ({ href, label }));
  // في التثبيت المحلي يظهر اسم الدخول بدل البريد الداخلي
  const login = localMulti ? (await usernamesOf([ctx.user.id])).get(ctx.user.id) : undefined;

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
            userName={tr(ctx.profile?.full_name ?? "")}
            userEmail={login ?? (isSupabaseConfigured() ? ctx.user.email ?? "" : "")}
            roleLabel={roleLabel}
            signOut={signOut}
            demo={!isSupabaseConfigured() && isDemoDataActive()}
            assistant={assistantConfig() !== null}
            quickActions={quickActions}
          />
          <main className="min-w-0 flex-1 overflow-y-auto px-4 pb-12 pt-1 md:px-10"><PageFrame>{children}</PageFrame></main>
        </div>
      </div>
    </div>
  );
}
