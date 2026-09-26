"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import Link from "@/components/link";
import { cn } from "@/lib/utils";
import { SIDEBAR_COOKIE, isActivePath, navGroups, type NavGroup, type NavLabels } from "./nav-config";

/**
 * شريط أيقونات نحيف (مثل التصميم المرجعي): أيقونة لكل مجموعة، والمجموعة النشطة دائرة
 * داكنة تنزلق بين الأيقونات. المرور أو النقر على مجموعة يفتح قائمة منبثقة بصفحاتها.
 * كل أيقونة رابط حقيقي لأول صفحة في مجموعتها (يعمل حتى بلا JavaScript).
 * زر في الأسفل يوسّع الشريط ليعرض كل الأقسام والصفحات بأسمائها، ويعيده أيقونات؛
 * الاختيار محفوظ في كوكي.
 */
export function Sidebar({ labels, initialExpanded = false }: { labels: NavLabels; initialExpanded?: boolean }) {
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
    if (groups[index]!.items.length < 2) { setOpen(null); return; }
    const r = el.getBoundingClientRect();
    setOpen({ index, top: r.top, right: window.innerWidth - r.left + 10 });
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
      animate={{ width: expanded ? 252 : 72 }}
      transition={{ type: "spring", stiffness: 300, damping: 32 }}
      className="no-print relative hidden shrink-0 flex-col py-3 md:flex"
    >
      {expanded ? (
        <ExpandedNav groups={groups} pathname={pathname} />
      ) : (
      <div className="flex flex-1 flex-col items-center gap-1 overflow-y-auto">
      <LayoutGroup id="rail">
        {groups.map((g, i) => {
          const active = i === activeGroup;
          return (
            <Link
              key={g.title}
              href={g.items[0]!.href}
              aria-label={g.title}
              aria-haspopup={g.items.length > 1 ? "menu" : undefined}
              aria-expanded={g.items.length > 1 ? open?.index === i : undefined}
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
                "group relative flex size-11 items-center justify-center rounded-full transition-colors duration-200",
                active ? "text-white" : "text-slate-500 hover:bg-white hover:text-ink",
                open?.index === i && !active && "bg-white text-ink",
              )}
            >
              {active && (
                <motion.span layoutId="rail-active" className="absolute inset-0 rounded-full bg-ink" transition={{ type: "spring", stiffness: 420, damping: 34 }} />
              )}
              <g.icon className="relative z-10 size-[19px] transition-transform duration-200 group-hover:scale-110" />
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

      {/* زر التوسيع / الطي */}
      <div className={cn("pt-2", expanded ? "px-3" : "flex justify-center")}>
        <button
          type="button"
          onClick={toggle}
          aria-label={expanded ? "طي القائمة" : "توسيع القائمة"}
          title={expanded ? "طي القائمة" : "توسيع القائمة"}
          className={cn(
            "flex h-11 items-center gap-2.5 rounded-full border border-line bg-white text-[13px] text-slate-600 transition-all duration-200 hover:border-ink hover:bg-ink hover:text-white",
            expanded ? "w-full justify-center px-4" : "size-11 justify-center",
          )}
        >
          {expanded ? <PanelRightClose className="size-[18px]" /> : <PanelRightOpen className="size-[18px]" />}
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
  const maxTop = typeof window === "undefined" ? top : Math.max(12, Math.min(top - 8, window.innerHeight - (group.items.length * 42 + 64)));
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
      className="fixed z-50 w-60 rounded-2xl border border-line bg-white p-2 shadow-[0_24px_60px_-20px_rgba(17,24,39,0.35)]"
    >
      <p className="px-3 pb-1.5 pt-1 text-[11px] text-slate-400">{group.title}</p>
      {group.items.map((item, i) => {
        const active = isActivePath(pathname, item.href);
        return (
          <motion.div key={item.href} initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.025 }}>
            <Link
              role="menuitem"
              href={item.href}
              className={cn(
                "flex h-10 items-center gap-3 rounded-xl px-3 text-[13px] transition-colors",
                active ? "bg-ink text-white" : "text-slate-600 hover:bg-panel hover:text-ink",
              )}
            >
              <item.icon className="size-[17px] shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          </motion.div>
        );
      })}
    </motion.div>
  );
}

/** الشريط الموسّع: كل الأقسام والصفحات بأسمائها، بلون كل قسم */
function ExpandedNav({ groups, pathname }: { groups: NavGroup[]; pathname: string }) {
  const activeHref = groups
    .flatMap((g) => g.items)
    .filter((i) => isActivePath(pathname, i.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <LayoutGroup id="expanded">
      <motion.nav
        initial={{ opacity: 0, x: 12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.25, delay: 0.05 }}
        className="flex-1 space-y-3 overflow-y-auto overflow-x-hidden px-3 pb-2"
      >
        {groups.map((g) => (
          <div key={g.title} className="space-y-0.5">
            {g.items.length > 1 && (
              <p className="flex items-center gap-2 px-3 pb-1 pt-1.5 text-[11px] font-medium text-slate-400">
                <span className="size-1.5 rounded-full" style={{ background: g.color }} />
                {g.title}
              </p>
            )}
            {g.items.map((item) => {
              const active = item.href === activeHref;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex h-10 items-center gap-3 rounded-full px-2 text-[13px] transition-colors duration-200",
                    active ? "text-white" : "text-slate-600 hover:bg-white hover:text-ink",
                  )}
                >
                  {active && (
                    <motion.span layoutId="expanded-active" className="absolute inset-0 rounded-full bg-ink" transition={{ type: "spring", stiffness: 420, damping: 36 }} />
                  )}
                  <span
                    className="relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full transition-transform duration-200 group-hover:scale-110"
                    style={active ? { background: g.color, color: "#fff" } : { background: `${g.color}1a`, color: g.color }}
                  >
                    <item.icon className="size-[15px]" />
                  </span>
                  <span className="relative z-10 truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </motion.nav>
    </LayoutGroup>
  );
}
