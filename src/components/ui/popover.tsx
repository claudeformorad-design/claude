"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { cn } from "@/lib/utils";

type Anchor = React.RefObject<HTMLElement | null>;

/**
 * لوحة عائمة بنمط Notion تحت عنصر (أو فوقه إن ضاقت المساحة): تتبع التمرير وتغيّر الحجم،
 * وتُغلق بالضغط خارجها أو بـ Esc. تستخدمها قائمة الاختيار والتقويم.
 */
export function Popover({ open, anchor, onClose, width, maxHeight = 360, className, children }: {
  open: boolean;
  anchor: Anchor;
  onClose: () => void;
  /** عرض ثابت، وإلا فعرض العنصر (220 على الأقل) */
  width?: number;
  maxHeight?: number;
  className?: string;
  children: React.ReactNode;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <Panel anchor={anchor} onClose={onClose} width={width} maxHeight={maxHeight} className={className}>{children}</Panel>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function Panel({ anchor, onClose, width, maxHeight, className, children }: {
  anchor: Anchor; onClose: () => void; width?: number; maxHeight: number; className?: string; children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = React.useState<{ top: number; left: number; width: number; up: boolean; max: number } | null>(null);

  React.useLayoutEffect(() => {
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      const up = below < Math.min(maxHeight, 280) && above > below;
      const w = width ?? Math.max(r.width, 220);
      // يبقى داخل الشاشة أفقيًا؛ وفي RTL تتطابق حافته اليمنى مع حافة الحقل
      const rtl = document.documentElement.dir === "rtl";
      const left = Math.min(Math.max(8, rtl ? r.right - w : r.left), window.innerWidth - w - 8);
      setPos({ top: up ? r.top - 6 : r.bottom + 6, left, width: w, up, max: Math.min(maxHeight, Math.max(160, up ? above : below)) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [anchor, width, maxHeight]);

  React.useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.current?.contains(t)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [anchor, onClose]);

  if (!pos) return null;
  return (
    <m.div
      ref={ref}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); anchor.current?.focus(); }
        else if (e.key === "Tab") onClose();
      }}
      className={cn("popover-panel fixed z-[60] flex flex-col overflow-hidden rounded-xl border border-line bg-white p-1.5 outline-none", className)}
      style={{ left: pos.left, width: pos.width, maxHeight: pos.max, ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }}
      initial={{ opacity: 0, y: pos.up ? 4 : -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
      onAnimationStart={() => { if (!ref.current?.contains(document.activeElement)) ref.current?.focus({ preventScroll: true }); }}
    >
      {children}
    </m.div>
  );
}

/**
 * تغيير قيمة حقل أصلي من الكود بحيث يلتقطه React (onChange) وReact Hook Form كأن المستخدم كتبها
 */
export function setNativeValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}
