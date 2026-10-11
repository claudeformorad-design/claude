"use client";
import { tr } from "@/i18n/tr";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DatabaseBackup, Download, ShieldCheck, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { actionErrorText, callAction } from "@/lib/action-error";
import { restoreBackupAction, verifyBackupAction } from "../../_admin/actions";
import { BackupSummaryView, type Summary } from "./backup-summary";

/** النسخ الاحتياطي: تنزيل ملف لكامل البيانات، واستعادته عند الحاجة (تستبدل البيانات الحالية) */
export function BackupCard({ errors }: { errors: Record<string, string> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const probe = useRef<HTMLInputElement>(null);
  const [checking, startCheck] = useTransition();
  const [checked, setChecked] = useState<{ name: string; summary: Summary } | null>(null);

  // فحص ملف (من فلاشة مثلًا) قبل الاعتماد عليه أو استعادته، دون أن يمس البيانات الحالية
  const check = (file: File) => startCheck(async () => {
    setError(null); setChecked(null);
    const form = new FormData();
    form.set("file", file);
    const r = await callAction(verifyBackupAction(form));
    if (r.ok) setChecked({ name: file.name, summary: r.data }); else setError(actionErrorText(errors, r));
  });

  const restore = (file: File) => {
    if (!window.confirm(tr("الاستعادة تستبدل كل البيانات الحالية بمحتوى النسخة. متابعة؟"))) return;
    start(async () => {
      setError(null);
      const form = new FormData();
      form.set("file", file);
      const r = await callAction(restoreBackupAction(form));
      if (!r.ok) return setError(actionErrorText(errors, r));
      toast(tr("تمت استعادة النسخة الاحتياطية"));
      router.push("/");
      router.refresh();
    });
  };

  return (
    <div className="surface space-y-5 p-6">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-start gap-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-subtle text-slate-700"><DatabaseBackup className="size-5 stroke-[1.75]" /></span>
        <div className="space-y-1">
          <h3 className="text-[18.5px] font-semibold text-ink">{tr("النسخ الاحتياطي")}</h3>
          <p className="max-w-xl text-[16.5px] leading-relaxed text-slate-600">{tr("نزّل نسخة كاملة من البيانات بحساباتها وحجوزاتها وفواتيرها، واحفظها خارج الجهاز يوميًا. الاستعادة تعيد النظام كما كان وقت النسخة.")}</p>
          {error && <p className="text-[15.5px] text-urgent">{error}</p>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline"><a href="/api/backup" download><Download />{tr("تنزيل نسخة")}</a></Button>
        <Button variant="outline" loading={checking} onClick={() => probe.current?.click()}><ShieldCheck />{tr("فحص ملف")}</Button>
        <Button variant="outline" loading={pending} onClick={() => input.current?.click()}><Upload />{tr("استعادة نسخة")}</Button>
        <input ref={probe} type="file" accept=".gz,.tgz,application/gzip" aria-label={tr("ملف للفحص")} className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) check(f); }} />
        <input ref={input} type="file" accept=".gz,.tgz,application/gzip" aria-label={tr("ملف النسخة الاحتياطية")} className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) restore(f); }} />
      </div>
    </div>
    {checked && <BackupSummaryView title={checked.name} summary={checked.summary} />}
    </div>
  );
}
