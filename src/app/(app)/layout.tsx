import { LogOut } from "lucide-react";
import { Sidebar } from "@/components/layout/sidebar";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { Button } from "@/components/ui/button";
import { requireAppContext } from "@/lib/auth/context";
import { getI18n } from "@/i18n/server";
import { signOutAction } from "../login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAppContext();
  const { locale, t } = await getI18n();
  const hotelName = (locale === "en" && ctx.hotel.name_en) || ctx.hotel.name_ar;

  return (
    <div className="flex h-screen">
      <Sidebar labels={t.nav} hotelName={hotelName} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b bg-card px-6">
          <p className="text-sm font-medium text-muted-foreground">{t.app.name}</p>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{ctx.profile?.full_name || ctx.user.email}</span>
            <LocaleSwitcher locale={locale} label={t.common.language} />
            <form action={signOutAction}>
              <Button variant="ghost" size="sm" type="submit">
                <LogOut className="rtl:rotate-180" />
                {t.common.signOut}
              </Button>
            </form>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
