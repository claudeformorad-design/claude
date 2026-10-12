"use client";
import { tr } from "@/i18n/tr";

import { useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { CalendarCheck, LogOut, Menu, Plus, Search, Settings } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import Link from "@/components/link";
import { cn } from "@/lib/utils";
import { Popover } from "@/components/ui/popover";
import { LanguageSwitch } from "@/components/language-switch";
import { isActivePath, navGroups, type NavAccess, type NavLabels } from "./nav-config";
import { SearchBox } from "./search-box";
import { AssistantLauncher } from "@/components/assistant/launcher";


export function TopBar({
  labels,
  access,
  hotelName,
  userName,
  userEmail,
  roleLabel,
  signOut,
  demo = false,
  assistant = false,
  quickActions = [],
}: {
  /** الإجراءات السريعة لدور المستخدم، مفلترة بصلاحياته */
  quickActions?: { href: string; label: string }[];
  demo?: boolean;
  /** زر المساعد الذكي يظهر فقط حين يُضبط مفتاح مزود الذكاء الاصطناعي على الخادم */
  assistant?: boolean;
  labels: NavLabels;
  access: NavAccess;
  hotelName: string;
  userName: string;
  userEmail: string;
  roleLabel: string;
  signOut?: () => Promise<void>;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();
  const groups = useMemo(() => navGroups(labels, access), [labels, access]);
  const current = groups.flatMap((g) => g.items).filter((i) => isActivePath(pathname, i.href)).sort((a, b) => b.href.length - a.href.length)[0];

  const iconBtn = "flex size-10 shrink-0 items-center justify-center rounded-lg border border-line bg-white text-slate-600 transition-colors duration-200 hover:text-ink";
  const group = current ? groups.find((g) => g.items.includes(current)) : undefined;
  // الروابط الثابتة في الرأس تظهر فقط لمن يملك فتح صفحتها
  const reachable = new Set(groups.flatMap((g) => g.items.map((i) => i.href)));

  return (
    <header className="no-print relative flex h-[72px] shrink-0 items-center gap-3 px-4 md:px-10">
      {/* الجوال: الشعار بدل زر القائمة (القائمة في الشريط السفلي) */}
      <Link href="/" aria-label={tr("الرئيسية")} className="shrink-0 md:hidden"><BrandMark className="size-10" /></Link>

      {/* مسار التنقّل */}
      <nav aria-label={tr("المسار")} className="flex min-w-0 flex-1 items-center gap-5 text-[16.5px] text-muted-foreground">
        <span className="truncate md:hidden text-ink font-medium">{hotelName}</span>
        <span className="hidden truncate md:inline">{hotelName}</span>
        {group?.title && group.items.length > 1 && (
          <>
            <span className="hidden truncate md:inline">{group.title}</span>
          </>
        )}
        {current && (
          <>
            <span key={current.href} className="animate-fade hidden truncate text-ink md:inline">{current.label}</span>
          </>
        )}
      </nav>

      <SearchBox groups={groups} className="hidden w-80 md:block lg:w-96" />

      <div className="flex items-center gap-2">
        {assistant && <AssistantLauncher />}
        {demo && (
          <Link href="/settings/hotel" title={tr("بيانات تجريبية مؤقتة، احذفها من الإعدادات")}
            className="hidden h-8 items-center whitespace-nowrap rounded-md bg-sky-tint px-3 text-[15.5px] font-medium text-sky sm:flex">{tr("بيانات تجريبية")}</Link>
        )}
        <button type="button" onClick={() => setSearchOpen((v) => !v)} className={cn(iconBtn, "md:hidden")} title={tr("بحث")} aria-label={tr("بحث")}>
          <Search className="size-[18px] stroke-[1.75]" />
        </button>
        <LanguageSwitch className="hidden sm:flex" />
        {quickActions.length > 0 && <QuickActions actions={quickActions} />}
        {reachable.has("/periods") && (
          <Link href="/periods" className={cn(iconBtn, "hidden sm:flex")} title={labels.periods} aria-label={labels.periods}>
            <CalendarCheck className="size-[18px] stroke-[1.75]" />
          </Link>
        )}
        {reachable.has("/settings/hotel") && (
          <Link href="/settings/hotel" className={cn(iconBtn, "max-md:hidden")} title={labels.hotelSettings} aria-label={labels.hotelSettings}>
            <Settings className="size-[18px] stroke-[1.75]" />
          </Link>
        )}

      </div>

      {searchOpen && (
        <div className="absolute inset-x-4 top-[64px] z-50 md:hidden">
          <SearchBox groups={groups} autoFocus onDone={() => setSearchOpen(false)} />
        </div>
      )}
      <MobileTabBar groups={groups} pathname={pathname} onMenu={() => setDrawerOpen(true)} />
      <AnimatePresence>
        {drawerOpen && <MobileDrawer groups={groups} pathname={pathname} hotelName={hotelName} user={[userName || userEmail, roleLabel].filter(Boolean).join("، ")} signOut={signOut} onClose={() => setDrawerOpen(false)} />}
      </AnimatePresence>
    </header>
  );
}

/** الجوال: شريط سفلي ثابت بأهم الشاشات لدور المستخدم وزر القائمة، يُستخدم بإبهام واحدة */
const TAB_PRIORITY = ["/", "/front-desk", "/reservations", "/folios", "/cashier", "/pos", "/journal", "/vouchers", "/invoices", "/hr", "/housekeeping"];
/** أسماء قصيرة تتسع للشريط السفلي */
const SHORT: Record<string, () => string> = {
  "/": () => tr("الرئيسية"), "/front-desk": () => tr("الاستقبال"), "/reservations": () => tr("الحجوزات"), "/folios": () => tr("الفوليو"),
  "/cashier": () => tr("الصندوق"), "/pos": () => tr("البيع"), "/journal": () => tr("القيود"), "/vouchers": () => tr("السندات"),
  "/invoices": () => tr("الفواتير"), "/hr": () => tr("الموظفون"), "/housekeeping": () => tr("التدبير"),
};
function MobileTabBar({ groups, pathname, onMenu }: { groups: ReturnType<typeof navGroups>; pathname: string; onMenu: () => void }) {
  const items = groups.flatMap((g) => g.items);
  const tabs = TAB_PRIORITY.map((h) => items.find((i) => i.href === h)).filter((i): i is (typeof items)[number] => !!i).slice(0, 4);
  const active = items.filter((i) => isActivePath(pathname, i.href)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav aria-label={tr("التنقل السريع")}
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      {tabs.map((t) => {
        const on = active === t.href;
        return (
          <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined}
            className={cn("flex min-w-0 flex-1 flex-col items-center gap-1 pb-2 pt-2.5 text-[12.5px]", on ? "font-semibold text-accent1" : "text-slate-500")}>
            <t.icon className="size-[22px] stroke-[1.75]" />
            <span className="w-full truncate px-1 text-center">{SHORT[t.href]?.() ?? t.label}</span>
          </Link>
        );
      })}
      <button type="button" onClick={onMenu} className="flex min-w-0 flex-1 flex-col items-center gap-1 pb-2 pt-2.5 text-[12.5px] text-slate-500">
        <Menu className="size-[22px] stroke-[1.75]" />
        <span>{tr("القائمة")}</span>
      </button>
    </nav>
  );
}

function QuickActions({ actions }: { actions: { href: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button ref={btn} type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={tr("جديد")}
        className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-ink px-3 text-[16px] font-medium text-white transition-opacity hover:opacity-90">
        <Plus className="size-[18px] stroke-[2]" /><span className="hidden sm:inline">{tr("جديد")}</span>
      </button>
      <Popover open={open} anchor={btn} onClose={() => setOpen(false)} width={230}>
        <div className="p-1.5">
          {actions.map((a) => (
            <Link key={a.href} href={a.href} onClick={() => setOpen(false)}
              className="flex h-10 items-center rounded-lg px-3 text-[16px] text-ink transition-colors hover:bg-subtle">{a.label}</Link>
          ))}
        </div>
      </Popover>
    </>
  );
}

function MobileDrawer({ groups, pathname, hotelName, user, signOut, onClose }: { groups: ReturnType<typeof navGroups>; pathname: string; hotelName: string; user: string; signOut?: () => Promise<void>; onClose: () => void }) {
  return (
    <m.div className="fixed inset-0 z-50 bg-ink/20 md:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <m.nav
        onClick={(e) => e.stopPropagation()}
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 34 }}
        className="absolute inset-y-3 end-auto start-3 w-72 overflow-y-auto rounded-[20px] bg-sidebar p-4 shadow-lift"
      >
        <div className="mb-4 flex items-center gap-2.5 px-2">
          <BrandMark className="size-9 shrink-0" />
          <span className="min-w-0"><span className="block truncate text-[18px] font-semibold text-ink">{hotelName}</span>
            {user && <span className="block truncate text-[14px] text-slate-500">{user}</span>}</span>
        </div>
        {groups.map((g, gi) => (
          <div key={gi} className="mb-3 space-y-1">
            {g.title && <p className="px-3 text-[14.5px] text-slate-400">{g.title}</p>}
            {g.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  "flex h-10 items-center gap-3 rounded-[10px] px-3 text-[16.5px]",
                  isActivePath(pathname, item.href) ? "bg-accent1-tint font-semibold text-accent1" : "text-slate-700 hover:bg-subtle",
                )}
              >
                <item.icon className="size-[18px] stroke-[1.75]" />
                {item.label}
              </Link>
            ))}
          </div>
        ))}
        <LanguageSwitch className="mx-1 mt-2 w-[calc(100%-0.5rem)] justify-center" />
        {signOut && (
          <form action={signOut} className="mt-2 px-1">
            <button type="submit" className="flex h-10 w-full items-center gap-3 rounded-[10px] px-2 text-[16.5px] text-slate-500 hover:text-urgent">
              <LogOut className="size-[18px] stroke-[1.75]" />{tr("تسجيل الخروج")}</button>
          </form>
        )}
      </m.nav>
    </m.div>
  );
}
