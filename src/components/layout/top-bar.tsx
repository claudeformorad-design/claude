"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { CalendarCheck, ChevronLeft, CornerDownLeft, LogOut, Menu, Search, Settings, X } from "lucide-react";
import Link from "@/components/link";
import { cn } from "@/lib/utils";
import { OPEN_SEARCH_EVENT, isActivePath, navGroups, type NavItem, type NavLabels } from "./nav-config";

/** تطبيع عربي بسيط للبحث: توحيد الألف والتاء المربوطة والياء وإزالة التشكيل */
const norm = (s: string) =>
  s.toLowerCase().replace(/[ً-ْ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");


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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();
  const groups = useMemo(() => navGroups(labels), [labels]);
  const current = groups.flatMap((g) => g.items).filter((i) => isActivePath(pathname, i.href)).sort((a, b) => b.href.length - a.href.length)[0];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    const onOpen = () => setPaletteOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SEARCH_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_SEARCH_EVENT, onOpen);
    };
  }, []);

  const initials = (userName || userEmail || "؟").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("");
  const iconBtn = "flex size-10 shrink-0 items-center justify-center rounded-full bg-white text-slate-500 shadow-soft transition-colors duration-200 hover:text-ink";
  const group = current ? groups.find((g) => g.items.includes(current)) : undefined;

  return (
    <header className="no-print flex h-[72px] shrink-0 items-center gap-3 px-4 md:px-10">
      <button type="button" onClick={() => setDrawerOpen(true)} className={cn(iconBtn, "md:hidden")} aria-label="القائمة">
        <Menu className="size-[18px] stroke-[1.75]" />
      </button>

      {/* مسار التنقّل */}
      <nav aria-label="المسار" className="flex min-w-0 flex-1 items-center gap-2 text-[14px] text-muted-foreground">
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

      <div className="flex items-center gap-2">
        {demo && (
          <Link href="/settings/hotel" title="بيانات تجريبية مؤقتة — احذفها من الإعدادات"
            className="flex h-8 items-center gap-1.5 rounded-full bg-accent2-tint px-3 text-[13px] font-medium text-accent2">
            <span className="size-1.5 rounded-full bg-accent2" />
            بيانات تجريبية
          </Link>
        )}
        <button type="button" onClick={() => setPaletteOpen(true)} className={cn(iconBtn, "md:hidden")} title="بحث (Ctrl K)" aria-label="بحث">
          <Search className="size-[18px] stroke-[1.75]" />
        </button>
        <Link href="/periods" className={cn(iconBtn, "hidden sm:flex")} title={labels.periods} aria-label={labels.periods}>
          <CalendarCheck className="size-[18px] stroke-[1.75]" />
        </Link>
        <Link href="/settings/hotel" className={iconBtn} title={labels.hotelSettings} aria-label={labels.hotelSettings}>
          <Settings className="size-[18px] stroke-[1.75]" />
        </Link>
        <span title={`${userName || userEmail} · ${roleLabel}`} className="flex size-10 items-center justify-center rounded-full bg-accent2 text-[14px] font-medium text-white md:hidden">
          {initials}
        </span>
      </div>

      <AnimatePresence>{paletteOpen && <CommandPalette groups={groups} onClose={() => setPaletteOpen(false)} />}</AnimatePresence>
      <AnimatePresence>
        {drawerOpen && <MobileDrawer groups={groups} pathname={pathname} hotelName={hotelName} signOut={signOut} onClose={() => setDrawerOpen(false)} />}
      </AnimatePresence>
    </header>
  );
}

function CommandPalette({ groups, onClose }: { groups: ReturnType<typeof navGroups>; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const all = useMemo(() => groups.flatMap((g) => g.items.map((i) => ({ ...i, group: g.title ?? "" }))), [groups]);
  const results = useMemo(() => {
    const n = norm(q.trim());
    if (!n) return all;
    // الترتيب: ما يبدأ بالنص، ثم ما يحتوي كلمة تبدأ به، ثم ما يحتويه في الاسم، ثم في المجموعة
    const score = (i: (typeof all)[number]) => {
      const l = norm(i.label);
      if (l.startsWith(n)) return 0;
      if (l.split(/\s+/).some((w) => w.startsWith(n))) return 1;
      if (l.includes(n)) return 2;
      return norm(i.group).includes(n) ? 3 : 9;
    };
    return all.map((i) => ({ i, s: score(i) })).filter((x) => x.s < 9).sort((a, b) => a.s - b.s).map((x) => x.i);
  }, [q, all]);
  const safeIndex = Math.min(index, Math.max(0, results.length - 1));

  useEffect(() => inputRef.current?.focus(), []);

  const go = (item: NavItem | undefined) => {
    if (!item) return;
    onClose();
    router.push(item.href);
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/20 px-4 pt-[12vh]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: -20, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -10, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 380, damping: 30 }}
        className="w-full max-w-xl overflow-hidden rounded-[20px] bg-white shadow-lift"
      >
        <div className="flex items-center gap-3 border-b border-line px-5">
          <Search className="size-5 text-slate-400" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setIndex(0); }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(i + 1, results.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
              if (e.key === "Enter") go(results[safeIndex]);
            }}
            placeholder="اكتب اسم الصفحة: فواتير، ميزان، رواتب…"
            className="h-14 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-slate-400"
          />
          <button type="button" onClick={onClose} className="flex size-8 items-center justify-center rounded-full text-slate-400 hover:bg-subtle">
            <X className="size-4" />
          </button>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 && <li className="px-4 py-8 text-center text-[14px] text-muted-foreground">لا توجد نتائج</li>}
          {results.map((item, i) => (
            <motion.li key={item.href} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 10) * 0.015 }}>
              <button
                type="button"
                onMouseEnter={() => setIndex(i)}
                onClick={() => go(item)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start text-[14px] transition-colors",
                  i === safeIndex ? "bg-subtle font-medium text-ink" : "text-slate-600",
                )}
              >
                <span className={cn("flex size-8 items-center justify-center rounded-lg", i === safeIndex ? "bg-white shadow-soft" : "bg-subtle")}>
                  <item.icon className="size-4 stroke-[1.75]" />
                </span>
                <span className="flex-1">{item.label}</span>
                {item.group && <span className={cn("text-[12px]", "text-slate-400")}>{item.group}</span>}
                {i === safeIndex && <CornerDownLeft className="size-3.5 text-slate-400" />}
              </button>
            </motion.li>
          ))}
        </ul>
      </motion.div>
    </motion.div>
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
        <p className="mb-3 px-2 text-[16px] font-semibold text-ink">{hotelName}</p>
        {groups.map((g, gi) => (
          <div key={gi} className="mb-3 space-y-1">
            {g.title && <p className="px-3 text-[12px] text-slate-400">{g.title}</p>}
            {g.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  "flex h-10 items-center gap-3 rounded-[10px] px-3 text-[14px]",
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
            <button type="submit" className="flex h-10 w-full items-center gap-3 rounded-[10px] px-2 text-[14px] text-slate-500 hover:text-urgent">
              <LogOut className="size-[18px] stroke-[1.75]" />
              تسجيل الخروج
            </button>
          </form>
        )}
      </motion.nav>
    </motion.div>
  );
}
