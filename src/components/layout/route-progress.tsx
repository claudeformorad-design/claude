"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";

/**
 * شريط تقدّم علوي أثناء التنقل: يبدأ عند النقر على رابط داخلي وينتهي عند تغيّر المسار/المعاملات.
 */
export function RouteProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [active, setActive] = useState(false);
  const key = `${pathname}?${search.toString()}`;
  const [seenKey, setSeenKey] = useState(key);

  // انتهاء التنقل: تغيّر العنوان ⇒ إخفاء الشريط (تحديث الحالة أثناء الرسم بدل effect)
  if (seenKey !== key) {
    setSeenKey(key);
    setActive(false);
  }

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target instanceof Element ? e.target.closest("a") : null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      setActive(true);
    };
    const onSubmit = () => setActive(true);
    document.addEventListener("click", onClick);
    document.addEventListener("submit", onSubmit);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("submit", onSubmit);
    };
  }, []);

  // الإرسال (Server Action) قد لا يغيّر العنوان: إخفاء احتياطي بعد مهلة
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => setActive(false), 8000);
    return () => clearTimeout(t);
  }, [active]);

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          key="bar"
          className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[3px] origin-right"
          initial={{ scaleX: 0, opacity: 1 }}
          animate={{ scaleX: 0.85, transition: { duration: 4, ease: [0.1, 0.8, 0.2, 1] } }}
          exit={{ scaleX: 1, opacity: 0, transition: { duration: 0.35 } }}
          style={{ background: "#2e90fa" }}
        />
      )}
    </AnimatePresence>
  );
}
