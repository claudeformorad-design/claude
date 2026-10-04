"use client";
import { tr } from "@/i18n/tr";

import { useEffect } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** شريط أعلى نسخة الطباعة (على الشاشة فقط)؛ يفتح نافذة الطباعة تلقائيًا بعد تحميل الخطوط */
export function PrintToolbar() {
  useEffect(() => {
    let cancelled = false;
    document.fonts.ready.then(() => { if (!cancelled) setTimeout(() => window.print(), 250); });
    return () => { cancelled = true; };
  }, []);
  return (
    <div className="mx-auto mb-6 flex max-w-[210mm] items-center justify-between gap-3 px-2 print:hidden">
      <p className="text-[15px] text-slate-600">{tr("نسخة الطباعة")}</p>
      <Button onClick={() => window.print()}><Printer />{tr("طباعة")}</Button>
    </div>
  );
}
