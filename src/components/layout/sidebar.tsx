"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { LayoutGroup, motion } from "motion/react";
import { Building2, PanelRightClose, PanelRightOpen } from "lucide-react";
import Link from "@/components/link";
import { cn } from "@/lib/utils";
import { SIDEBAR_COOKIE, isActivePath, navGroups, type NavLabels } from "./nav-config";

/**
 * شريط جانبي زجاجي قابل للطي: موسّع (أيقونة + اسم) أو شريط أيقونات دائرية.
 * العنصر النشط «حبة» داكنة تنزلق بين العناصر (layoutId). الحالة محفوظة في كوكي
 * حتى تُرسم من الخادم بنفس الشكل دون وميض.
 */
export function Sidebar({ labels, hotelName, initialCollapsed }: { labels: NavLabels; hotelName: string; initialCollapsed: boolean }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const groups = navGroups(labels);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  };

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 84 : 256 }}
      transition={{ type: "spring", stiffness: 260, damping: 30 }}
      className="relative hidden h-full shrink-0 flex-col border-e border-white/70 md:flex"
    >
      <div className={cn("flex items-center gap-3 px-5 pb-4 pt-6", collapsed && "justify-center px-0")}>
        <motion.div
          whileHover={{ rotate: -8, scale: 1.06 }}
          className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-ink text-white shadow-[0_10px_24px_-10px_rgba(14,17,22,0.7)]"
        >
          <Building2 className="size-5" />
        </motion.div>
        {!collapsed && (
          <motion.div initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} className="min-w-0">
            <p className="truncate text-[15px] font-semibold text-ink">{hotelName}</p>
            <p className="text-[11px] text-muted-foreground">النظام المحاسبي الفندقي</p>
          </motion.div>
        )}
      </div>

      <LayoutGroup id="sidebar">
        <nav className="flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-3 pb-4">
          {groups.map((group, gi) => (
            <div key={gi} className="space-y-1">
              {group.title &&
                (collapsed ? (
                  <div className="mx-auto my-2 h-px w-8 bg-slate-300/60" />
                ) : (
                  <p className="px-3 pb-1 pt-2 text-[11px] font-medium text-slate-400">{group.title}</p>
                ))}
              {group.items.map((item) => {
                const active = isActivePath(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={collapsed ? item.label : undefined}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex h-10 items-center gap-3 rounded-full text-[13px] transition-colors duration-200",
                      collapsed ? "mx-auto w-10 justify-center" : "px-3",
                      active ? "text-white" : "text-slate-600 hover:bg-white/70 hover:text-ink",
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="nav-active"
                        className="absolute inset-0 rounded-full bg-ink shadow-[0_8px_20px_-8px_rgba(14,17,22,0.7)]"
                        transition={{ type: "spring", stiffness: 420, damping: 34 }}
                      />
                    )}
                    <item.icon className={cn("relative z-10 size-[18px] shrink-0 transition-transform duration-200 group-hover:scale-110", active ? "text-white" : "text-slate-500")} />
                    {!collapsed && <span className="relative z-10 truncate">{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </LayoutGroup>

      <div className="border-t border-white/70 p-3">
        <button
          type="button"
          onClick={toggle}
          className={cn(
            "flex h-10 w-full items-center gap-3 rounded-full px-3 text-[13px] text-slate-500 transition-colors hover:bg-white/70 hover:text-ink",
            collapsed && "justify-center px-0",
          )}
          aria-label={collapsed ? "توسيع القائمة" : "طي القائمة"}
        >
          {collapsed ? <PanelRightOpen className="size-[18px]" /> : <PanelRightClose className="size-[18px]" />}
          {!collapsed && <span>طي القائمة</span>}
        </button>
      </div>
    </motion.aside>
  );
}
