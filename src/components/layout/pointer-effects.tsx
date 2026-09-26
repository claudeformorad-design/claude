"use client";

import { useEffect } from "react";

/**
 * موجة (ripple) تنتشر من نقطة النقر على الأزرار — مستمع واحد للصفحة كلها.
 * تُعطَّل تلقائيًا عند تفضيل تقليل الحركة.
 */
export function PointerEffects() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const onDown = (e: PointerEvent) => {
      const btn = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-slot="button"]') : null;
      if (!btn || btn.matches(":disabled")) return;
      const r = btn.getBoundingClientRect();
      const size = Math.max(r.width, r.height) * 2.2;
      const ripple = document.createElement("span");
      ripple.className = "ripple";
      ripple.style.width = ripple.style.height = `${size}px`;
      ripple.style.left = `${e.clientX - r.left - size / 2}px`;
      ripple.style.top = `${e.clientY - r.top - size / 2}px`;
      btn.appendChild(ripple);
      ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
    };
    document.addEventListener("pointerdown", onDown, { passive: true });
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);
  return null;
}
