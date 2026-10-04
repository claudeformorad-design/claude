"use client";
import { tr } from "@/i18n/tr";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { actionErrorText, callAction } from "@/lib/action-error";
import type { ActionResult } from "@/services/errors";

type Variant = "default" | "outline" | "ghost" | "destructive" | "secondary" | "link";

/**
 * زر ينفّذ عملية خادم واحدة (تأكيد، إلغاء، حذف...). مع reasonLabel يطلب سببًا في حقل
 * ينسدل تحت الزر قبل التنفيذ. الأخطاء تظهر كرسالة عربية دقيقة من قاعدة البيانات.
 */
export function ActionButton({
  run, label, done, errors, variant = "outline", size = "sm", confirmText, reasonLabel, reasonRequired = true, href, icon,
}: {
  run: (reason: string) => Promise<ActionResult<unknown>>;
  label: string;
  done: string;
  errors: Record<string, string>;
  variant?: Variant;
  size?: "sm" | "default";
  confirmText?: string;
  reasonLabel?: string;
  reasonRequired?: boolean;
  /** الانتقال بعد النجاح (وإلا تُحدَّث الصفحة)؛ «:id» يُستبدل بناتج العملية */
  href?: string;
  icon?: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");

  const exec = (why: string) =>
    start(async () => {
      const r = await callAction(run(why));
      if (r.ok) {
        toast(done);
        setAsking(false);
        setReason("");
        if (href) router.push(href.replace(":id", String(r.data ?? "")));
        else router.refresh();
      } else toast(actionErrorText(errors, r), "error");
    });

  const click = () => {
    if (reasonLabel) { setAsking((x) => !x); return; }
    if (confirmText && !window.confirm(confirmText)) return;
    exec("");
  };

  return (
    <div className="relative inline-flex flex-col">
      <Button type="button" variant={variant} size={size} loading={pending && !asking} onClick={click}>{icon}{label}</Button>
      <AnimatePresence>
        {asking && (
          <m.form
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}
            onSubmit={(e) => { e.preventDefault(); if (!reasonRequired || reason.trim()) exec(reason.trim()); }}
            className="absolute end-0 top-full z-30 mt-2 w-80 space-y-2 rounded-lg border border-line bg-white p-3 shadow-lift"
          >
            <label className="block text-[15px] font-medium text-ink">{reasonLabel}</label>
            <Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex gap-2">
              <Button type="submit" size="sm" variant={variant === "destructive" ? "destructive" : "default"} loading={pending}
                disabled={reasonRequired && !reason.trim()}>{label}</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setAsking(false)}>{tr("تراجع")}</Button>
            </div>
          </m.form>
        )}
      </AnimatePresence>
    </div>
  );
}
