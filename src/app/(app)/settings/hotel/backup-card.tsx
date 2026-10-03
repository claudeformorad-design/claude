"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DatabaseBackup, Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { actionErrorText, callAction } from "@/lib/action-error";
import { restoreBackupAction } from "../../_admin/actions";

/** النسخ الاحتياطي: تنزيل ملف لكامل البيانات، واستعادته عند الحاجة (تستبدل البيانات الحالية) */
export function BackupCard({ errors }: { errors: Record<string, string> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const restore = (file: File) => {
    if (!window.confirm("الاستعادة تستبدل كل البيانات الحالية بمحتوى النسخة. متابعة؟")) return;
    start(async () => {
      setError(null);
      const form = new FormData();
      form.set("file", file);
      const r = await callAction(restoreBackupAction(form));
      if (!r.ok) return setError(actionErrorText(errors, r));
      toast("تمت استعادة النسخة الاحتياطية");
      router.push("/");
      router.refresh();
    });
  };

  return (
    <div className="surface flex flex-wrap items-center justify-between gap-4 p-6">
      <div className="flex min-w-0 items-start gap-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-subtle text-slate-700"><DatabaseBackup className="size-5 stroke-[1.75]" /></span>
        <div className="space-y-1">
          <h3 className="text-[18.5px] font-semibold text-ink">النسخ الاحتياطي</h3>
          <p className="max-w-xl text-[16.5px] leading-relaxed text-slate-600">
            نزّل نسخة كاملة من البيانات بحساباتها وحجوزاتها وفواتيرها، واحفظها خارج الجهاز يوميًا. الاستعادة تعيد النظام كما كان وقت النسخة.
          </p>
          {error && <p className="text-[15.5px] text-urgent">{error}</p>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline"><a href="/api/backup" download><Download />تنزيل نسخة</a></Button>
        <Button variant="outline" loading={pending} onClick={() => input.current?.click()}><Upload />استعادة نسخة</Button>
        <input ref={input} type="file" accept=".gz,.tgz,application/gzip" aria-label="ملف النسخة الاحتياطية" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) restore(f); }} />
      </div>
    </div>
  );
}
