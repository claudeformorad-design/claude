"use client";
import { tr } from "@/i18n/tr";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, LayoutGroup } from "motion/react";
import * as m from "motion/react-m";
import { ChevronDown, LogOut, PanelRightClose, PanelRightOpen } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import Link from "@/components/link";
import { cn } from "@/lib/utils";
import { SIDEBAR_COOKIE, isActivePath, navGroups, type NavAccess, type NavGroup, type NavLabels } from "./nav-config";

const spring = { type: "spring", stiffness: 420, damping: 34 } as const;

/**
 * الشريط الجانبي: قاعدة بيضاء بحافة واضحة، وعنصر نشط واحد داكن (أسود بنص أبيض).
 * • مطويًا: شريط أيقونات؛ المرور أو النقر على مجموعة يفتح قائمة منبثقة بصفحاتها.
 * • موسّعًا: الأقسام كمجموعات قابلة للطي (رأس بأيقونة وعنوان واضح، وتحته صفحاته على خط إرشادي)،
 *   ومجموعة الصفحة الحالية مفتوحة تلقائيًا.
 * كل رابط حقيقي (يعمل حتى بلا JavaScript)، وحالة التوسيع محفوظة في كوكي.
 */
export function Sidebar({
  labels, access, hotelName, signOut, initialExpanded = false,
}: {
  labels: NavLabels;
  access: NavAccess;
  hotelName: string;
  signOut?: () => Promise<void>;
  initialExpanded?: boolean;
}) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(initialExpanded);
  const groups = navGroups(labels, access);
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
    <m.aside
      initial={false}
      animate={{ width: expanded ? 304 : 80 }}
      transition={{ type: "spring", stiffness: 300, damping: 32 }}
      className="no-print relative hidden shrink-0 flex-col overflow-hidden border-e border-line bg-sidebar py-5 md:flex"
    >
      {/* الشعار واسم المنشأة */}
      <Link href="/" className={cn("mb-6 flex items-center gap-3", expanded ? "px-5" : "justify-center")} title={hotelName}>
        <BrandMark className="size-11" />
        {expanded && (
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[18.5px] font-bold text-ink">{hotelName}</span>
            <span className="block text-[15px] text-slate-500">{tr("النظام المحاسبي الفندقي")}</span>
          </span>
        )}
      </Link>

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
                    "group relative flex size-12 items-center justify-center rounded-[10px] transition-colors duration-200",
                    active ? "text-white" : "text-slate-600 hover:bg-subtle hover:text-ink",
                    open?.index === i && !active && "bg-subtle text-ink",
                  )}
                >
                  {active && (
                    <m.span layoutId="rail-active" transition={spring}
                      className="absolute inset-0 rounded-[10px] bg-ink" />
                  )}
                  <g.icon className="relative z-10 size-5 stroke-[1.9] transition-transform duration-200 group-hover:scale-110" />
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
            <button type="submit" title={tr("تسجيل الخروج")} aria-label={tr("تسجيل الخروج")}
              className="flex size-10 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-urgent-tint hover:text-urgent">
              <LogOut className="size-[18px] stroke-[1.9]" />
            </button>
          </form>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-label={expanded ? tr("طي القائمة") : tr("توسيع القائمة")}
          title={expanded ? tr("طي القائمة") : tr("توسيع القائمة")}
          className={cn(
            "flex h-10 items-center justify-center gap-2.5 rounded-lg text-[16.5px] font-medium text-slate-600 transition-colors duration-200 hover:bg-subtle hover:text-ink",
            expanded ? "flex-1 px-3" : "size-10",
          )}
        >
          {expanded ? <PanelRightClose className="size-[18px] stroke-[1.9]" /> : <PanelRightOpen className="size-[18px] stroke-[1.9]" />}
          {expanded && <span>{tr("طي القائمة")}</span>}
        </button>
      </div>
    </m.aside>
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
    <m.div
      role="menu"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      initial={{ opacity: 0, x: 10, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 6, scale: 0.98, transition: { duration: 0.12 } }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
      style={{ top: maxTop, right }}
      className="fixed z-50 w-64 rounded-[10px] border border-line bg-white p-2 shadow-lift"
    >
      <p className="flex items-center gap-2 px-3 pb-2 pt-1.5 text-[16px] font-bold text-ink">
        <group.icon className="size-4 stroke-[1.9]" />
        {group.title}
      </p>
      {group.items.map((item, i) => {
        const active = isActivePath(pathname, item.href);
        return (
          <m.div key={item.href} initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.025 }}>
            <Link
              role="menuitem"
              href={item.href}
              className={cn(
                "flex h-10 items-center gap-3 rounded-[10px] px-3 text-[17px] font-medium transition-colors",
                active ? "bg-ink text-white" : "text-slate-700 hover:bg-subtle hover:text-ink",
              )}
            >
              <item.icon className="size-[17px] shrink-0 stroke-[1.9]" />
              <span className="truncate">{item.label}</span>
            </Link>
          </m.div>
        );
      })}
    </m.div>
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
                className={cn("group relative flex h-11 items-center gap-3 rounded-lg px-2 text-[17.5px] font-semibold transition-colors",
                  active ? "text-white" : "text-ink hover:bg-subtle")}>
                {active && <m.span layoutId="expanded-active" transition={spring} className="absolute inset-0 rounded-lg bg-ink" />}
                <span className={cn("relative z-10 flex size-8 items-center justify-center rounded-[10px] transition-colors",
                  active ? "bg-white/15" : "bg-subtle group-hover:bg-white")}>
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
                className="group flex h-11 w-full items-center gap-3 rounded-lg px-2 text-[17.5px] font-semibold text-ink transition-colors hover:bg-subtle">
                <span className={cn("flex size-8 items-center justify-center rounded-[10px] transition-colors",
                  groupActive ? "bg-ink text-white" : "bg-subtle text-ink group-hover:bg-white")}>
                  <g.icon className="size-[17px] stroke-[1.9]" />
                </span>
                <span className="flex-1 truncate text-start">{g.title}</span>
                <span className="text-[14.5px] font-medium text-slate-500">{g.items.length}</span>
                <ChevronDown className={cn("size-4 text-slate-500 transition-transform duration-200", isOpen && "rotate-180")} />
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <m.div
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
                              "group relative flex h-10 items-center gap-2.5 rounded-[10px] px-2.5 text-[17px] font-medium transition-colors duration-200",
                              active ? "text-white" : "text-slate-700 hover:bg-subtle hover:text-ink",
                            )}
                          >
                            {active && (
                              <m.span layoutId="expanded-active" transition={spring} className="absolute inset-0 rounded-[10px] bg-ink" />
                            )}
                            <item.icon className="relative z-10 size-[17px] shrink-0 stroke-[1.9] transition-transform duration-200 group-hover:scale-110" />
                            <span className="relative z-10 truncate">{item.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </m.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </nav>
    </LayoutGroup>
  );
}
