import { ShieldCheck } from "lucide-react";
import { Sidebar } from "@/components/layout/sidebar";
import { Badge } from "@/components/ui/badge";
import { requireAppContext } from "@/lib/auth/context";
import { getI18n } from "@/i18n/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAppContext();
  const { t } = await getI18n();
  const hotelName = ctx.hotel.name_ar || ctx.hotel.name_en || "";

  return (
    <div className="flex h-screen bg-[#F8FAF9]">
      <Sidebar labels={t.nav} hotelName={hotelName} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="relative flex h-14 shrink-0 items-center justify-between border-b border-[#E2E8F0] bg-white px-6 shadow-2xs">
          <div className="absolute top-0 inset-x-0 h-0.5 bg-gradient-to-r from-[#1E293B] via-[#FFD369] to-[#1E293B]" />
          <div className="flex items-center gap-2.5">
            <span className="text-xs font-black text-[#0F172A] tracking-tight">{t.app.name}</span>
            <span className="text-[10px] text-[#64748B] font-bold hidden sm:inline-flex items-center gap-1.5">
              <span className="size-1 rounded-full bg-[#D97706]" />
              منصة الإدارة المالية الموحدة USALI
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Badge variant="default" className="gap-1.5 bg-[#0F172A] text-[#FFD369] border-[#0F172A] px-2.5 py-1 text-[11px] font-extrabold shadow-2xs">
                <ShieldCheck className="size-3.5 text-[#FFD369]" />
                مدير النظام
              </Badge>
              <span className="text-xs font-bold text-[#0F172A] hidden md:inline">{ctx.profile?.full_name || ctx.user.email}</span>
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6 scrollbar-thin">
          {children}
        </main>
      </div>
    </div>
  );
}
