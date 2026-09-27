"use client";

import { useEffect } from "react";
import { FileSpreadsheet, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** شريط أعلى الورقة على الشاشة فقط؛ يفتح نافذة الطباعة تلقائيًا بعد تحميل الخطوط */
export function PrintToolbar({ excelHref }: { excelHref: string }) {
  useEffect(() => {
    let cancelled = false;
    document.fonts.ready.then(() => { if (!cancelled) setTimeout(() => window.print(), 250); });
    return () => { cancelled = true; };
  }, []);
  return (
    <div className="mx-auto mb-6 flex max-w-[210mm] items-center justify-between gap-3 px-2 print:hidden">
      <p className="text-[15px] text-slate-600">اختر «حفظ بتنسيق PDF» من نافذة الطباعة</p>
      <div className="flex gap-2">
        <Button variant="outline" asChild><a href={excelHref}><FileSpreadsheet />Excel</a></Button>
        <Button onClick={() => window.print()}><Printer />حفظ PDF</Button>
      </div>
    </div>
  );
}
