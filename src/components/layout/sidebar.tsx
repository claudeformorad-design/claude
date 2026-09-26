"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { Building2, ChevronDown, LogOut, PanelRightClose, PanelRightOpen, Search } from "lucide-react";
import Link from "@/components/link";
import { cn } from "@/lib/utils";
import { OPEN_SEARCH_EVENT, SIDEBAR_COOKIE, isActivePath, navGroups, type NavGroup, type NavLabels } from "./nav-config";

const openSearch = () => window.dispatchEvent(new Event(OPEN_SEARCH_EVENT));
const spring = { type: "spring", stiffness: 420, damping: 34 } as const;

/**
 * الشريط الجانبي: قاعدة بيضاء بحافة واضحة، وعنصر نشط واحد داكن (أسود بنص أبيض).
 * • مطويًا: شريط أيقونات؛ المرور أو النقر على مجموعة يفتح قائمة منبثقة بصفحاتها.
 * • موسّعًا: الأقسام كمجموعات قابلة للطي (رأس بأيقونة وعنوان واضح، وتحته صفحاته على خط إرشادي)،
 *   ومجموعة الصفحة الحالية مفتوحة تلقائيًا.
 * كل رابط حقيقي (يعمل حتى بلا JavaScript)، وحالة التوسيع محفوظة في كوكي.
 */
export function Sidebar({
  labels, hotelName, signOut, initialExpanded = false,
}: {
  labels: NavLabels;
  hotelName: string;
  signOut?: () => Promise<void>;
  initialExpanded?: boolean;
}) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(initialExpanded);
  const groups = navGroups(labels);
  const [open, setOpen] = useState<{ index: number; top: number; right: number } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    setOpen(null);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  };

  const activeGroup = groups.findIndex((g) => g.items.some((i) => isActivePath(pathname, i.href)));

  const show = (index: number, el: HTMLElement) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    const r = el.getBoundingClientRect();
    setOpen({ index, top: r.top, right: window.innerWidth - r.left + 12 });
  };
  const scheduleClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(null), 160);
  };

  // إغلاق القائمة عند التنقل أو Escape
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setOpen(null);
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <motion.aside
      initial={false}
      animate={{ width: expanded ? 268 : 80 }}
      transition={{ type: "spring", stiffness: 300, damping: 32 }}
      className="no-print relative hidden shrink-0 flex-col overflow-hidden border-e border-line bg-white py-5 md:flex"
    >
      {/* الشعار واسم المنشأة */}
      <Link href="/" className={cn("mb-5 flex items-center gap-3", expanded ? "px-5" : "justify-center")} title={hotelName}>
        <span className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-ink text-white shadow-[0_6px_14px_-6px_rgba(0,0,0,0.5)]">
          <Building2 className="size-5 stroke-[1.75]" />
        </span>
        {expanded && (
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[15px] font-bold text-ink">{hotelName}</span>
            <span className="block text-[11.5px] text-slate-500">النظام المحاسبي الفندقي</span>
          </span>
        )}
      </Link>

      {/* البحث */}
      <div className={cn("mb-4", expanded ? "px-4" : "flex justify-center")}>
        {expanded ? (
          <button type="button" onClick={openSearch}
            className="flex h-10 w-full items-center gap-2.5 rounded-xl border border-line bg-panel px-3 text-[13px] text-slate-500 transition-colors hover:border-line-strong hover:text-ink">
            <Search className="size-4 stroke-[1.9]" />
            <span className="flex-1 text-start">ابحث عن صفحة…</span>
            <kbd className="rounded-md bg-white px-1.5 py-0.5 text-[10px] text-slate-500 shadow-soft">Ctrl K</kbd>
          </button>
        ) : (
          <button type="button" onClick={openSearch} aria-label="بحث" title="بحث (Ctrl K)"
            className="flex size-12 items-center justify-center rounded-[14px] border border-line bg-panel text-slate-600 transition-colors hover:text-ink">
            <Search className="size-[19px] stroke-[1.9]" />
          </button>
        )}
      </div>

      {expanded ? (
        <ExpandedNav groups={groups} pathname={pathname} activeGroup={activeGroup} />
      ) : (
        <div className="flex flex-1 flex-col items-center gap-1.5 overflow-y-auto overflow-x-hidden py-1">
          <LayoutGroup id="rail">
            {groups.map((g, i) => {
              const active = i === activeGroup;
              return (
                <Link
                  key={g.title}
                  href={g.items[0]!.href}
                  aria-label={g.title}
                  aria-haspopup="menu"
                  aria-expanded={open?.index === i}
                  onMouseEnter={(e) => show(i, e.currentTarget)}
                  onMouseLeave={scheduleClose}
                  onFocus={(e) => show(i, e.currentTarget)}
                  onClick={(e) => {
                    if (g.items.length > 1) {
                      e.preventDefault();
                      show(i, e.currentTarget);
                    }
                  }}
                  className={cn(
                    "group relative flex size-12 items-center justify-center rounded-[14px] transition-colors duration-200",
                    active ? "text-white" : "text-slate-600 hover:bg-subtle hover:text-ink",
                    open?.index === i && !active && "bg-subtle text-ink",
                  )}
                >
                  {active && (
                    <motion.span layoutId="rail-active" transition={spring}
                      className="absolute inset-0 rounded-[14px] bg-ink shadow-[0_8px_18px_-8px_rgba(0,0,0,0.55)]" />
                  )}
                  <g.icon className="relative z-10 size-5 stroke-[1.9] transition-transform duration-200 group-hover:scale-110" />
                  {active && <span className="absolute -end-[17px] top-1/2 z-10 h-5 w-1 -translate-y-1/2 rounded-full bg-ink" />}
                </Link>
              );
            })}
          </LayoutGroup>

          <AnimatePresence>
            {open && (
              <Flyout
                key={open.index}
                group={groups[open.index]!}
                top={open.top}
                right={open.right}
                pathname={pathname}
                onEnter={() => closeTimer.current && clearTimeout(closeTimer.current)}
                onLeave={scheduleClose}
              />
            )}
          </AnimatePresence>
        </div>
      )}

      {/* الأسفل: الخروج (عند وجود حسابات) وزر التوسيع / الطي */}
      <div className={cn("mt-3 flex gap-2 border-t border-line pt-3", expanded ? "px-4" : "flex-col items-center")}>
        {signOut && (
          <form action={signOut} className={expanded ? "" : "contents"}>
            <button type="submit" title="تسجيل الخروج" aria-label="تسجيل الخروج"
              className="flex size-10 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-urgent-tint hover:text-urgent">
              <LogOut className="size-[18px] stroke-[1.9]" />
            </button>
          </form>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-label={expanded ? "طي القائمة" : "توسيع القائمة"}
          title={expanded ? "طي القائمة" : "توسيع القائمة"}
          className={cn(
            "flex h-10 items-center justify-center gap-2.5 rounded-xl text-[13px] font-medium text-slate-600 transition-colors duration-200 hover:bg-subtle hover:text-ink",
            expanded ? "flex-1 px-3" : "size-10",
          )}
        >
          {expanded ? <PanelRightClose className="size-[18px] stroke-[1.9]" /> : <PanelRightOpen className="size-[18px] stroke-[1.9]" />}
          {expanded && <span>طي القائمة</span>}
        </button>
      </div>
    </motion.aside>
  );
}

function Flyout({
  group, top, right, pathname, onEnter, onLeave,
}: {
  group: NavGroup;
  top: number;
  right: number;
  pathname: string;
  onEnter: () => void;
  onLeave: () => void;
}) {
  // لا تتجاوز القائمة أسفل الشاشة
  const maxTop = typeof window === "undefined" ? top : Math.max(12, Math.min(top - 8, window.innerHeight - (group.items.length * 44 + 70)));
  return (
    <motion.div
      role="menu"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      initial={{ opacity: 0, x: 10, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 6, scale: 0.98, transition: { duration: 0.12 } }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
      style={{ top: maxTop, right }}
      className="fixed z-50 w-64 rounded-2xl border border-line bg-white p-2 shadow-lift"
    >
      <p className="flex items-center gap-2 px-3 pb-2 pt-1.5 text-[12.5px] font-bold text-ink">
        <group.icon className="size-4 stroke-[1.9]" />
        {group.title}
      </p>
      {group.items.map((item, i) => {
        const active = isActivePath(pathname, item.href);
        return (
          <motion.div key={item.href} initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.025 }}>
            <Link
              role="menuitem"
              href={item.href}
              className={cn(
                "flex h-10 items-center gap-3 rounded-[10px] px-3 text-[13.5px] font-medium transition-colors",
                active ? "bg-ink text-white" : "text-slate-700 hover:bg-subtle hover:text-ink",
              )}
            >
              <item.icon className="size-[17px] shrink-0 stroke-[1.9]" />
              <span className="truncate">{item.label}</span>
            </Link>
          </motion.div>
        );
      })}
    </motion.div>
  );
}

/**
 * الشريط الموسّع: كل قسم رأسٌ واضح (أيقونة في مربع + عنوان + سهم طي)، وتحته صفحاته
 * على خط إرشادي. عنصر نشط واحد داكن بعلامة جانبية.
 */
function ExpandedNav({ groups, pathname, activeGroup }: { groups: NavGroup[]; pathname: string; activeGroup: number }) {
  const activeHref = groups
    .flatMap((g) => g.items)
    .filter((i) => isActivePath(pathname, i.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const [openGroups, setOpenGroups] = useState<Set<number>>(() => new Set(activeGroup >= 0 ? [activeGroup] : []));
  // عند الانتقال لقسم آخر يُفتح تلقائيًا
  const [seen, setSeen] = useState(activeGroup);
  if (seen !== activeGroup) {
    setSeen(activeGroup);
    if (activeGroup >= 0 && !openGroups.has(activeGroup)) setOpenGroups(new Set([...openGroups, activeGroup]));
  }
  const flip = (i: number) => setOpenGroups((s) => {
    const n = new Set(s);
    if (n.has(i)) n.delete(i); else n.add(i);
    return n;
  });

  return (
    <LayoutGroup id="expanded">
      <nav className="flex-1 space-y-1 overflow-y-auto overflow-x-hidden px-3 pb-2">
        {groups.map((g, gi) => {
          const groupActive = gi === activeGroup;
          // مجموعة من صفحة واحدة (لوحة التحكم): رابط مباشر بنفس شكل رأس المجموعة
          if (g.items.length === 1) {
            const item = g.items[0]!;
            const active = item.href === activeHref;
            return (
              <Link key={g.title} href={item.href} aria-current={active ? "page" : undefined}
                className={cn("group relative flex h-11 items-center gap-3 rounded-xl px-2 text-[14px] font-semibold transition-colors",
                  active ? "text-white" : "text-ink hover:bg-subtle")}>
                {active && <motion.span layoutId="expanded-active" transition={spring} className="absolute inset-0 rounded-xl bg-ink shadow-[0_8px_18px_-10px_rgba(0,0,0,0.6)]" />}
                <span className={cn("relative z-10 flex size-8 items-center justify-center rounded-[10px] transition-colors",
                  active ? "bg-white/15" : "bg-subtle group-hover:bg-white group-hover:shadow-soft")}>
                  <item.icon className="size-[17px] stroke-[1.9]" />
                </span>
                <span className="relative z-10">{item.label}</span>
              </Link>
            );
          }
          const isOpen = openGroups.has(gi);
          return (
            <div key={g.title}>
              <button type="button" onClick={() => flip(gi)} aria-expanded={isOpen}
                className="group flex h-11 w-full items-center gap-3 rounded-xl px-2 text-[14px] font-semibold text-ink transition-colors hover:bg-subtle">
                <span className={cn("flex size-8 items-center justify-center rounded-[10px] transition-colors",
                  groupActive ? "bg-ink text-white" : "bg-subtle text-ink group-hover:bg-white group-hover:shadow-soft")}>
                  <g.icon className="size-[17px] stroke-[1.9]" />
                </span>
                <span className="flex-1 text-start">{g.title}</span>
                <span className="text-[11px] font-medium text-slate-500">{g.items.length}</span>
                <ChevronDown className={cn("size-4 text-slate-500 transition-transform duration-200", isOpen && "rotate-180")} />
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="relative ms-[23px] space-y-0.5 border-s-2 border-line py-1 ps-3">
                      {g.items.map((item) => {
                        const active = item.href === activeHref;
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            aria-current={active ? "page" : undefined}
                            className={cn(
                              "group relative flex h-10 items-center gap-2.5 rounded-[10px] px-2.5 text-[13.5px] font-medium transition-colors duration-200",
                              active ? "text-white" : "text-slate-700 hover:bg-subtle hover:text-ink",
                            )}
                          >
                            {active && (
                              <>
                                <motion.span layoutId="expanded-active" transition={spring} className="absolute inset-0 rounded-[10px] bg-ink shadow-[0_8px_18px_-10px_rgba(0,0,0,0.6)]" />
                                <span className="absolute -start-[15px] top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-ink" />
                              </>
                            )}
                            <item.icon className="relative z-10 size-[17px] shrink-0 stroke-[1.9] transition-transform duration-200 group-hover:scale-110" />
                            <span className="relative z-10 truncate">{item.label}</span>
                            {active && <span className="relative z-10 ms-auto size-1.5 rounded-full bg-accent2" />}
                          </Link>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </nav>
    </LayoutGroup>
  );
}
