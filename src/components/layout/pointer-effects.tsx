"use client";

import { useEffect } from "react";

/**
 * مؤثرات المؤشر العامة (مستمع واحد لكل الصفحة، بلا إعادة رسم React):
 *  • .spotlight : بقعة ضوء ناعمة تتبع المؤشر داخل البطاقة (--mx / --my)
 *  • .tilt      : إمالة ثلاثية الأبعاد خفيفة حسب موضع المؤشر (--rx / --ry)
 *  • الأزرار    : موجة (ripple) من نقطة النقر
 * تُعطَّل تلقائيًا عند تفضيل تقليل الحركة.
 */
export function PointerEffects() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    let last: HTMLElement | null = null;

    const onMove = (e: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const target = e.target instanceof Element ? e.target : null;
        const spot = target?.closest<HTMLElement>(".spotlight, .tilt") ?? null;
        if (last && last !== spot) {
          last.style.removeProperty("--rx");
          last.style.removeProperty("--ry");
        }
        last = spot;
        if (!spot) return;
        const r = spot.getBoundingClientRect();
        const x = e.clientX - r.left;
        const y = e.clientY - r.top;
        spot.style.setProperty("--mx", `${x}px`);
        spot.style.setProperty("--my", `${y}px`);
        if (spot.classList.contains("tilt")) {
          spot.style.setProperty("--ry", `${((x / r.width) - 0.5) * 7}deg`);
          spot.style.setProperty("--rx", `${(0.5 - y / r.height) * 7}deg`);
        }
      });
    };

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

    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerdown", onDown, { passive: true });
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerdown", onDown);
      cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
