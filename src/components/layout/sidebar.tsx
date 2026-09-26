"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { Building2, LogOut, PanelRightClose, PanelRightOpen, Search } from "lucide-react";
import Link from "@/components/link";
import { cn } from "@/lib/utils";
import { OPEN_SEARCH_EVENT, SIDEBAR_COOKIE, isActivePath, navGroups, type NavGroup, type NavLabels } from "./nav-config";

type UserInfo = { name: string; email: string; role: string; signOut?: () => Promise<void> };

const openSearch = () => window.dispatchEvent(new Event(OPEN_SEARCH_EVENT));
const initialsOf = (s: string) => (s || "؟").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("");

/**
 * الشريط الجانبي: خلفية شبه بيضاء منفصلة بلطف عن منطقة العمل.
 * • مطويًا: شريط أيقونات؛ المرور أو النقر على مجموعة يفتح قائمة منبثقة بصفحاتها.
 * • موسّعًا: الشعار، حقل البحث، المجموعات بعناوين رمادية صغيرة، وبطاقة المستخدم في الأسفل.
 * عنصر نشط واحد فقط (خلفية بيضاء بظل خفيف ونص أغمق)، وكل ما عداه رمادي محايد.
 * كل أيقونة رابط حقيقي لأول صفحة في مجموعتها (يعمل حتى بلا JavaScript)، والاختيار محفوظ في كوكي.
 */
export function Sidebar({
  labels, hotelName, user, initialExpanded = false,
}: {
  labels: NavLabels;
  hotelName: string;
  user: UserInfo;
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
    if (groups[index]!.items.length < 2) { setOpen(null); return; }
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

  const railBtn = "flex size-11 items-center justify-center rounded-xl text-slate-600 transition-colors duration-200 hover:bg-subtle hover:text-ink";

  return (
    <motion.aside
      initial={false}
      animate={{ width: expanded ? 256 : 76 }}
      transition={{ type: "spring", stiffness: 300, damping: 32 }}
      className="no-print relative hidden shrink-0 flex-col overflow-hidden border-e border-line bg-sidebar py-5 md:flex"
    >
      {/* الشعار واسم المنشأة */}
      <Link href="/" className={cn("mb-5 flex items-center gap-3", expanded ? "px-5" : "justify-center")} title={hotelName}>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-ink text-white">
          <Building2 className="size-[18px] stroke-[1.75]" />
        </span>
        {expanded && (
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[15px] font-semibold text-ink">{hotelName}</span>
            <span className="block text-[11.5px] text-slate-500">النظام المحاسبي الفندقي</span>
          </span>
        )}
      </Link>

      {/* البحث */}
      <div className={cn("mb-4", expanded ? "px-4" : "flex justify-center")}>
        {expanded ? (
          <button type="button" onClick={openSearch}
            className="flex h-10 w-full items-center gap-2.5 rounded-[10px] bg-subtle px-3 text-[13px] text-slate-500 transition-colors hover:text-ink">
            <Search className="size-4 stroke-[1.75]" />
            <span className="flex-1 text-start">بحث</span>
            <kbd className="text-[10px] text-slate-400">Ctrl K</kbd>
          </button>
        ) : (
          <button type="button" onClick={openSearch} aria-label="بحث" title="بحث (Ctrl K)" className={cn(railBtn, "bg-subtle")}>
            <Search className="size-[18px] stroke-[1.75]" />
          </button>
        )}
      </div>

      {expanded ? (
        <ExpandedNav groups={groups} pathname={pathname} />
      ) : (
        <div className="flex flex-1 flex-col items-center gap-1.5 overflow-y-auto">
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
                  className={cn("group relative", railBtn, active && "text-accent1 hover:bg-transparent hover:text-accent1", open?.index === i && !active && "bg-subtle text-ink")}
                >
                  {active && (
                    <motion.span layoutId="rail-active" className="absolute inset-0 rounded-xl bg-accent1-tint" transition={{ type: "spring", stiffness: 420, damping: 34 }} />
                  )}
                  <g.icon className="relative z-10 size-[19px] stroke-[1.75]" />
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

      {/* الأسفل: المستخدم وزر التوسيع / الطي */}
      <div className={cn("mt-3 space-y-2", expanded ? "px-4" : "flex flex-col items-center")}>
        {expanded ? (
          <div className="flex items-center gap-3 rounded-xl bg-subtle p-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent2 text-[12px] font-medium text-white">{initialsOf(user.name || user.email)}</span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-[13px] font-medium text-ink">{user.name || user.email}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{user.email || user.role}</span>
            </span>
            {user.signOut && (
              <form action={user.signOut}>
                <button type="submit" title="تسجيل الخروج" className="flex size-7 items-center justify-center rounded-lg text-slate-400 hover:text-urgent">
                  <LogOut className="size-4 stroke-[1.75]" />
                </button>
              </form>
            )}
          </div>
        ) : (
          <span title={`${user.name || user.email} · ${user.role}`} className="flex size-9 items-center justify-center rounded-full bg-accent2 text-[12px] font-medium text-white">
            {initialsOf(user.name || user.email)}
          </span>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-label={expanded ? "طي القائمة" : "توسيع القائمة"}
          title={expanded ? "طي القائمة" : "توسيع القائمة"}
          className={cn(
            "flex h-10 items-center gap-2.5 rounded-[10px] text-[13px] font-medium text-slate-600 transition-colors duration-200 hover:bg-subtle hover:text-ink",
            expanded ? "w-full px-3" : "size-11 justify-center",
          )}
        >
          {expanded ? <PanelRightClose className="size-[18px] stroke-[1.75]" /> : <PanelRightOpen className="size-[18px] stroke-[1.75]" />}
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
      className="fixed z-50 w-60 rounded-2xl bg-white p-2 shadow-lift"
    >
      <p className="px-3 pb-1.5 pt-1 text-[11.5px] font-semibold text-slate-500">{group.title}</p>
      {group.items.map((item, i) => {
        const active = isActivePath(pathname, item.href);
        return (
          <motion.div key={item.href} initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.025 }}>
            <Link
              role="menuitem"
              href={item.href}
              className={cn(
                "flex h-10 items-center gap-3 rounded-[10px] px-3 text-[13px] transition-colors",
                active ? "bg-accent1-tint font-semibold text-accent1" : "text-slate-700 hover:bg-subtle hover:text-ink",
              )}
            >
              <item.icon className="size-[17px] shrink-0 stroke-[1.75]" />
              <span className="truncate">{item.label}</span>
            </Link>
          </motion.div>
        );
      })}
    </motion.div>
  );
}

/** الشريط الموسّع: المجموعات بعناوين رمادية صغيرة بلا خطوط فاصلة، وعنصر نشط واحد */
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
        className="flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-4 pb-2"
      >
        {groups.map((g) => (
          <div key={g.title} className="space-y-0.5">
            {g.items.length > 1 && <p className="px-3 pb-1.5 text-[11.5px] font-semibold text-slate-500">{g.title}</p>}
            {g.items.map((item) => {
              const active = item.href === activeHref;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex h-10 items-center gap-3 rounded-[10px] px-3 text-[13.5px] font-medium transition-colors duration-200",
                    active ? "font-semibold text-accent1" : "text-slate-700 hover:bg-subtle hover:text-ink",
                  )}
                >
                  {active && (
                    <motion.span layoutId="expanded-active" className="absolute inset-0 rounded-[10px] bg-accent1-tint" transition={{ type: "spring", stiffness: 420, damping: 36 }} />
                  )}
                  <item.icon className="relative z-10 size-[18px] shrink-0 stroke-[1.9]" />
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
