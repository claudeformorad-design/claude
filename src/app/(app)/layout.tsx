import { cookies } from "next/headers";
import { SIDEBAR_COOKIE } from "@/components/layout/nav-config";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { requireAppContext } from "@/lib/auth/context";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getI18n } from "@/i18n/server";
import { signOutAction } from "../login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAppContext();
  const { t } = await getI18n();
  const hotelName = ctx.hotel.name_ar || ctx.hotel.name_en || "";
  const collapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === "1";

  return (
    <div className="h-screen p-0 md:p-4">
      <div className="glass-shell flex h-full overflow-hidden md:rounded-[32px]">
        <Sidebar labels={t.nav} hotelName={hotelName} initialCollapsed={collapsed} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar
            labels={t.nav}
            hotelName={hotelName}
            userName={ctx.profile?.full_name ?? ""}
            userEmail={ctx.user.email ?? ""}
            signOut={isSupabaseConfigured() ? signOutAction : undefined}
          />
          <main className="flex-1 overflow-y-auto px-5 pb-10 pt-4 md:px-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
