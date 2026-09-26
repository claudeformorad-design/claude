"use client";

import { usePathname } from "next/navigation";
import { ar } from "@/i18n/dictionaries/ar";
import { isActivePath, navGroups } from "./nav-config";

const GROUPS = navGroups(ar.nav);

/** القسم والصفحة الحاليان من المسار (للون القسم وأيقونته في كل الصفحات) */
export function useSection() {
  const pathname = usePathname();
  let best: { group: (typeof GROUPS)[number]; item: (typeof GROUPS)[number]["items"][number] } | undefined;
  for (const group of GROUPS) {
    for (const item of group.items) {
      if (isActivePath(pathname, item.href) && (!best || item.href.length > best.item.href.length)) best = { group, item };
    }
  }
  return best;
}
