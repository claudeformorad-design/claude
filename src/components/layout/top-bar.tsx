"use client";

import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { CalendarCheck, ChevronLeft, LogOut, Menu, Search, Settings } from "lucide-react";
import Link from "@/components/link";
import { cn } from "@/lib/utils";
import { isActivePath, navGroups, type NavLabels } from "./nav-config";
import { SearchBox } from "./search-box";


export function TopBar({
  labels,
  hotelName,
  userName,
  userEmail,
  roleLabel,
  signOut,
  demo = false,
}: {
  demo?: boolean;
  labels: NavLabels;
  hotelName: string;
  userName: string;
  userEmail: string;
  roleLabel: string;
  signOut?: () => Promise<void>;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();
  const groups = useMemo(() => navGroups(labels), [labels]);
  const current = groups.flatMap((g) => g.items).filter((i) => isActivePath(pathname, i.href)).sort((a, b) => b.href.length - a.href.length)[0];

  const initials = (userName || userEmail || "؟").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("");
  const iconBtn = "flex size-10 shrink-0 items-center justify-center rounded-lg border border-line bg-white text-slate-600 transition-colors duration-200 hover:text-ink";
  const group = current ? groups.find((g) => g.items.includes(current)) : undefined;

  return (
    <header className="no-print relative flex h-[72px] shrink-0 items-center gap-3 px-4 md:px-10">
      <button type="button" onClick={() => setDrawerOpen(true)} className={cn(iconBtn, "md:hidden")} aria-label="القائمة">
        <Menu className="size-[18px] stroke-[1.75]" />
      </button>

      {/* مسار التنقّل */}
      <nav aria-label="المسار" className="flex min-w-0 flex-1 items-center gap-2 text-[16.5px] text-muted-foreground">
        <span className="truncate md:hidden text-ink font-medium">{hotelName}</span>
        <span className="hidden truncate md:inline">{hotelName}</span>
        {group?.title && group.items.length > 1 && (
          <>
            <ChevronLeft className="hidden size-3.5 shrink-0 text-slate-300 md:block" />
            <span className="hidden truncate md:inline">{group.title}</span>
          </>
        )}
        {current && (
          <>
            <ChevronLeft className="hidden size-3.5 shrink-0 text-slate-300 md:block" />
            <span key={current.href} className="animate-fade hidden truncate text-ink md:inline">{current.label}</span>
          </>
        )}
      </nav>

      <SearchBox groups={groups} className="hidden w-80 md:block lg:w-96" />

      <div className="flex items-center gap-2">
        {demo && (
          <Link href="/settings/hotel" title="بيانات تجريبية مؤقتة — احذفها من الإعدادات"
            className="flex h-8 items-center gap-1.5 rounded-md bg-sky-tint px-3 text-[15.5px] font-medium text-sky">
            <span className="size-1.5 rounded-full bg-sky-dot" />
            بيانات تجريبية
          </Link>
        )}
        <button type="button" onClick={() => setSearchOpen((v) => !v)} className={cn(iconBtn, "md:hidden")} title="بحث" aria-label="بحث">
          <Search className="size-[18px] stroke-[1.75]" />
        </button>
        <Link href="/periods" className={cn(iconBtn, "hidden sm:flex")} title={labels.periods} aria-label={labels.periods}>
          <CalendarCheck className="size-[18px] stroke-[1.75]" />
        </Link>
        <Link href="/settings/hotel" className={iconBtn} title={labels.hotelSettings} aria-label={labels.hotelSettings}>
          <Settings className="size-[18px] stroke-[1.75]" />
        </Link>
        <span title={`${userName || userEmail} · ${roleLabel}`} className="flex size-10 items-center justify-center rounded-lg bg-ink text-[16.5px] font-medium text-white md:hidden">
          {initials}
        </span>
      </div>

      {searchOpen && (
        <div className="absolute inset-x-4 top-[64px] z-50 md:hidden">
          <SearchBox groups={groups} autoFocus onDone={() => setSearchOpen(false)} />
        </div>
      )}
      <AnimatePresence>
        {drawerOpen && <MobileDrawer groups={groups} pathname={pathname} hotelName={hotelName} signOut={signOut} onClose={() => setDrawerOpen(false)} />}
      </AnimatePresence>
    </header>
  );
}

function MobileDrawer({ groups, pathname, hotelName, signOut, onClose }: { groups: ReturnType<typeof navGroups>; pathname: string; hotelName: string; signOut?: () => Promise<void>; onClose: () => void }) {
  return (
    <motion.div className="fixed inset-0 z-50 bg-ink/20 md:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.nav
        onClick={(e) => e.stopPropagation()}
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 34 }}
        className="absolute inset-y-3 end-auto start-3 w-72 overflow-y-auto rounded-[20px] bg-sidebar p-4 shadow-lift"
      >
        <p className="mb-3 px-2 text-[18.5px] font-semibold text-ink">{hotelName}</p>
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
        {signOut && (
          <form action={signOut} className="mt-2 px-1">
            <button type="submit" className="flex h-10 w-full items-center gap-3 rounded-[10px] px-2 text-[16.5px] text-slate-500 hover:text-urgent">
              <LogOut className="size-[18px] stroke-[1.75]" />
              تسجيل الخروج
            </button>
          </form>
        )}
      </motion.nav>
    </motion.div>
  );
}
