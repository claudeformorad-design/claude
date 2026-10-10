"use client";

import { usePathname } from "next/navigation";
import { dict } from "@/i18n/dict";
import { isActivePath, navGroups } from "./nav-config";


/** القسم والصفحة الحاليان من المسار (للون القسم وأيقونته في كل الصفحات) */
export function useSection() {
  const pathname = usePathname();
  const groups = navGroups(dict().nav);
  let best: { group: (typeof groups)[number]; item: (typeof groups)[number]["items"][number] } | undefined;
  for (const group of groups) {
    for (const item of group.items) {
      if (isActivePath(pathname, item.href) && (!best || item.href.length > best.item.href.length)) best = { group, item };
    }
  }
  return best;
}
