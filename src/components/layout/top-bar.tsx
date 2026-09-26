"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { Building2, CalendarCheck, CornerDownLeft, LogOut, Menu, Search, Settings, X } from "lucide-react";
import Link from "@/components/link";
import { cn } from "@/lib/utils";
import { OPEN_SEARCH_EVENT, isActivePath, navGroups, type NavItem, type NavLabels } from "./nav-config";

/** تطبيع عربي بسيط للبحث: توحيد الألف والتاء المربوطة والياء وإزالة التشكيل */
const norm = (s: string) =>
  s.toLowerCase().replace(/[ً-ْ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");

const RANGES = [
  { key: "today", label: "اليوم" },
  { key: "7d", label: "آخر 7 أيام" },
  { key: "month", label: "هذا الشهر" },
  { key: "fy", label: "السنة المالية" },
] as const;

/** مبدّل فترة لوحة التحكم (حبوب مُحدّدة في منتصف الرأس كما في التصميم المرجعي) */
function RangePills() {
  const search = useSearchParams();
  const current = RANGES.some((r) => r.key === search.get("range")) ? search.get("range") : "month";
  return (
    <LayoutGroup id="range">
      <nav className="flex items-center gap-1.5">
        {RANGES.map((r) => {
          const active = current === r.key;
          return (
            <Link
              key={r.key}
              href={r.key === "month" ? "/" : `/?range=${r.key}`}
              className={cn(
                "relative whitespace-nowrap rounded-full border px-4 py-2 text-[13px] transition-colors duration-200",
                active ? "border-ink text-white" : "border-line bg-white text-slate-600 hover:border-line-strong hover:text-ink",
              )}
            >
              {active && <motion.span layoutId="range-active" className="absolute inset-0 rounded-full bg-ink" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
              <span className="relative z-10">{r.label}</span>
            </Link>
          );
        })}
        <Link href="/reports/income-statement" className="whitespace-nowrap rounded-full border border-line bg-white px-4 py-2 text-[13px] text-slate-600 transition-colors hover:border-line-strong hover:text-ink">
          التقارير
        </Link>
      </nav>
    </LayoutGroup>
  );
}

export function TopBar({
  labels,
  hotelName,
  userName,
  userEmail,
  roleLabel,
  signOut,
}: {
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
  const iconBtn = "flex size-10 shrink-0 items-center justify-center rounded-full border border-line bg-white text-slate-600 transition-all duration-200 hover:border-line-strong hover:bg-white hover:text-ink";

  return (
    <header className="no-print flex h-[72px] shrink-0 items-center gap-3 border-b border-line bg-white px-4 md:px-7">
      <button type="button" onClick={() => setDrawerOpen(true)} className={cn(iconBtn, "md:hidden")} aria-label="القائمة">
        <Menu className="size-[18px]" />
      </button>

      {/* الشعار واسم المنشأة */}
      <Link href="/" className="flex min-w-0 items-center gap-2.5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-ink text-white">
          <Building2 className="size-[18px]" />
        </span>
        <span className="hidden min-w-0 leading-tight sm:block">
          <span className="block max-w-44 truncate text-[15px] font-medium text-ink">{hotelName}</span>
          <span className="block text-[10.5px] text-muted-foreground">النظام المحاسبي الفندقي</span>
        </span>
      </Link>

      {/* الوسط: مبدّل الفترة في لوحة التحكم، واسم الصفحة في غيرها */}
      <div className="flex min-w-0 flex-1 justify-start md:justify-center">
        {pathname === "/" ? (
          <div className="hidden lg:block">
            <Suspense fallback={null}>
              <RangePills />
            </Suspense>
          </div>
        ) : (
          current && <span key={current.href} className="animate-fade hidden truncate rounded-full border border-line bg-white px-4 py-2 text-[13px] text-ink lg:inline-block">{current.label}</span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setPaletteOpen(true)} className={iconBtn} title="بحث (Ctrl K)" aria-label="بحث">
          <Search className="size-[18px]" />
        </button>
        <Link href="/periods" className={cn(iconBtn, "hidden sm:flex")} title={labels.periods}>
          <CalendarCheck className="size-[18px]" />
        </Link>
        <Link href="/settings/hotel" className={cn(iconBtn, "hover:rotate-45")} title={labels.hotelSettings}>
          <Settings className="size-[18px]" />
        </Link>
        <div className="ms-1 flex items-center gap-2.5">
          <div className="flex size-10 items-center justify-center rounded-full bg-brand-blue text-[13px] font-medium text-white">
            {initials}
          </div>
          <div className="hidden leading-tight md:block">
            <p className="max-w-40 truncate text-[13px] font-medium text-ink">{userName || userEmail}</p>
            <p className="max-w-40 truncate text-[11px] text-muted-foreground">{roleLabel}</p>
          </div>
          {signOut && (
            <form action={signOut}>
              <button type="submit" title="تسجيل الخروج" className="flex size-8 items-center justify-center rounded-full text-slate-500 hover:bg-white hover:text-brand-red">
                <LogOut className="size-4" />
              </button>
            </form>
          )}
        </div>
      </div>

      <AnimatePresence>{paletteOpen && <CommandPalette groups={groups} onClose={() => setPaletteOpen(false)} />}</AnimatePresence>
      <AnimatePresence>
        {drawerOpen && <MobileDrawer groups={groups} pathname={pathname} hotelName={hotelName} onClose={() => setDrawerOpen(false)} />}
      </AnimatePresence>
    </header>
  );
}

/** حقل بحث كبير (مثل التصميم المرجعي) يفتح البحث السريع */
export function SearchPill({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_SEARCH_EVENT))}
      className={cn(
        "group flex h-12 w-full items-center gap-3 rounded-full border border-line bg-white px-5 text-[13px] text-slate-400 transition-all hover:border-line-strong hover:bg-white",
        className,
      )}
    >
      <Search className="size-[18px] transition-transform group-hover:scale-110" />
      <span className="flex-1 truncate text-start">ابحث عن صفحة أو تقرير أو إجراء…</span>
      <kbd className="hidden rounded-md border border-line bg-panel px-1.5 py-0.5 text-[10px] text-slate-500 sm:inline">Ctrl K</kbd>
    </button>
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
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/30 px-4 pt-[12vh]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: -20, scale: 0.96, filter: "blur(8px)" }}
        animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
        exit={{ opacity: 0, y: -10, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 380, damping: 30 }}
        className="w-full max-w-xl overflow-hidden rounded-3xl border border-line bg-white shadow-[0_30px_80px_-24px_rgba(17,24,39,0.45)]"
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
            className="h-14 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-slate-400"
          />
          <button type="button" onClick={onClose} className="flex size-8 items-center justify-center rounded-full text-slate-400 hover:bg-subtle">
            <X className="size-4" />
          </button>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 && <li className="px-4 py-8 text-center text-[13px] text-muted-foreground">لا توجد نتائج</li>}
          {results.map((item, i) => (
            <motion.li key={item.href} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 10) * 0.015 }}>
              <button
                type="button"
                onMouseEnter={() => setIndex(i)}
                onClick={() => go(item)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-start text-[13px] transition-colors",
                  i === safeIndex ? "bg-ink text-white" : "text-ink hover:bg-subtle",
                )}
              >
                <span className={cn("flex size-8 items-center justify-center rounded-full", i === safeIndex ? "bg-white/15" : "bg-subtle")}>
                  <item.icon className="size-4" />
                </span>
                <span className="flex-1">{item.label}</span>
                {item.group && <span className={cn("text-[11px]", i === safeIndex ? "text-white/60" : "text-slate-400")}>{item.group}</span>}
                {i === safeIndex && <CornerDownLeft className="size-3.5 text-white/60" />}
              </button>
            </motion.li>
          ))}
        </ul>
      </motion.div>
    </motion.div>
  );
}

function MobileDrawer({ groups, pathname, hotelName, onClose }: { groups: ReturnType<typeof navGroups>; pathname: string; hotelName: string; onClose: () => void }) {
  return (
    <motion.div className="fixed inset-0 z-50 bg-slate-900/30 md:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.nav
        onClick={(e) => e.stopPropagation()}
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 34 }}
        className="absolute inset-y-3 end-auto start-3 w-72 overflow-y-auto rounded-3xl border border-line bg-white p-4"
      >
        <p className="mb-3 px-2 text-[15px] font-semibold text-ink">{hotelName}</p>
        {groups.map((g, gi) => (
          <div key={gi} className="mb-3 space-y-1">
            {g.title && <p className="px-3 text-[11px] text-slate-400">{g.title}</p>}
            {g.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  "flex h-10 items-center gap-3 rounded-full px-3 text-[13px]",
                  isActivePath(pathname, item.href) ? "bg-ink text-white" : "text-slate-600 hover:bg-white",
                )}
              >
                <item.icon className="size-[18px]" />
                {item.label}
              </Link>
            ))}
          </div>
        ))}
      </motion.nav>
    </motion.div>
  );
}
