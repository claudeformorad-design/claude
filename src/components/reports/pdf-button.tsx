"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileText } from "lucide-react";
import { ReportDocument } from "@/components/reports/report-document";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import type { DocMeta, PlainReport } from "@/lib/export/plain-report";

type Payload = { report: PlainReport; meta: DocMeta; fileName: string };

/** تصدير PDF بضغطة: يجلب بيانات التقرير، يرسم المستند خارج الشاشة، ثم يُنزّل الملف مباشرة */
export function PdfButton({ href, label }: { href: string; label: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!data || !ref.current) return;
    const root = ref.current.firstElementChild as HTMLElement;
    import("@/lib/export/pdf")
      .then(({ downloadReportPdf }) => downloadReportPdf(root, {
        fileName: data.fileName, footer: data.meta.hotelName, landscape: data.report.columns.length > 5,
      }))
      .catch(() => toast("تعذّر إنشاء ملف PDF، حاول مرة أخرى"))
      .finally(() => { setData(null); setBusy(false); });
  }, [data]);

  const start = async () => {
    setBusy(true);
    try {
      const res = await fetch(href);
      if (!res.ok) throw new Error(String(res.status));
      setData(await res.json());
    } catch {
      toast("تعذّر إنشاء ملف PDF، حاول مرة أخرى");
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="outline" loading={busy} onClick={start}><FileText />{label}</Button>
      {data && createPortal(
        <div ref={ref} aria-hidden className="pointer-events-none fixed top-0 left-[-20000px]">
          <ReportDocument report={data.report} meta={data.meta} capture />
        </div>,
        document.body,
      )}
    </>
  );
}
