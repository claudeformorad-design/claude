"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, CircleAlert } from "lucide-react";

type Toast = { id: number; text: string; tone: "success" | "error" };
const EVENT = "app:toast";

/** إشعار قصير يؤكد نجاح العملية (يُستدعى من أي مكوّن عميل) */
export function toast(text: string, tone: Toast["tone"] = "success") {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { text, tone } }));
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    let seq = 0;
    const on = (e: Event) => {
      const { text, tone } = (e as CustomEvent<Omit<Toast, "id">>).detail;
      const id = ++seq;
      setItems((xs) => [...xs.slice(-2), { id, text, tone }]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 2800);
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex flex-col items-center gap-2" aria-live="polite">
      <AnimatePresence>
        {items.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 18, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97, transition: { duration: 0.18 } }}
            transition={{ type: "spring", stiffness: 480, damping: 32 }}
            className="flex items-center gap-2.5 rounded-lg bg-ink py-2.5 pe-5 ps-3 text-[16.5px] font-medium text-white shadow-lift"
          >
            {t.tone === "success"
              ? <CheckCircle2 className="size-[18px] text-accent1-soft" />
              : <CircleAlert className="size-[18px] text-accent2-soft" />}
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
