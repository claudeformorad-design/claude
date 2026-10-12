"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * الجوال: يكتب على كل خانة جدول عنوان عمودها (data-label)، فتعرضها أنماط الجوال بطاقات مقروءة
 * بدل جدول عريض مقصوص. لا أثر له على الكمبيوتر (الأنماط داخل استعلام الشاشة الصغيرة فقط).
 */
export function MobileTables() {
  const pathname = usePathname();
  useEffect(() => {
    const label = () => {
      document.querySelectorAll<HTMLElement>('[data-slot="table"], [data-mobile-cards]').forEach((wrap) => {
        const table = wrap.querySelector(":scope > table");
        const head = table?.querySelector(":scope > thead > tr:last-child");
        if (!table || !head || wrap.dataset.mobile === "scroll") return;
        const cols: string[] = [];
        head.querySelectorAll<HTMLTableCellElement>(":scope > th, :scope > td").forEach((th) => {
          for (let i = 0; i < (th.colSpan || 1); i++) cols.push(i === 0 ? (th.innerText || th.textContent || "").trim() : "");
        });
        table.querySelectorAll<HTMLTableRowElement>(":scope > tbody > tr, :scope > tfoot > tr").forEach((tr) => {
          let i = 0;
          for (const td of Array.from(tr.cells)) {
            const span = td.colSpan || 1;
            if (span > 1 && span >= cols.length - 1) td.setAttribute("data-span", "");
            td.setAttribute("data-label", span > 1 ? "" : cols[i] ?? "");
            i += span;
          }
        });
        wrap.setAttribute("data-cards", "");
      });
    };
    let frame = 0;
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(label); };
    schedule();
    const obs = new MutationObserver(schedule);
    obs.observe(document.body, { childList: true, subtree: true });
    return () => { obs.disconnect(); cancelAnimationFrame(frame); };
  }, [pathname]);
  return null;
}
