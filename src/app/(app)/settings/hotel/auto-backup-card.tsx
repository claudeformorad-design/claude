"use client";
import { tr } from "@/i18n/tr";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Download, Play } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { actionErrorText, callAction } from "@/lib/action-error";
import { runBackupNowAction, saveAutoBackupAction } from "../../_admin/actions";

type Settings = { enabled: boolean; folder: string; time: string; keep: number };
type Status = { last_success_at: string | null; last_file: string | null; last_error: string | null; last_attempt_at: string | null };
type File = { name: string; size: number; created_at: string };

const when = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;

/**
 * النسخ التلقائي اليومي: نسخة كاملة كل يوم بعد الوقت المحدد في المجلد المختار (يُفضَّل قرص خارجي أو مجلد مزامنة)،
 * مع الاحتفاظ بآخر النسخ. يظهر تنبيه إن فشلت آخر محاولة أو مر أكثر من يوم بلا نسخة.
 */
export function AutoBackupCard({ settings, status, stale, files, errors }: {
  settings: Settings; status: Status; stale: boolean; files: File[]; errors: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [running, startRun] = useTransition();
  const [v, setV] = useState({ ...settings, keep: String(settings.keep) });
  const [error, setError] = useState<string | null>(null);

  const save = () => start(async () => {
    setError(null);
    const r = await callAction(saveAutoBackupAction(v));
    if (r.ok) { toast(tr("تم حفظ إعدادات النسخ التلقائي")); router.refresh(); } else setError(actionErrorText(errors, r));
  });
  const runNow = () => startRun(async () => {
    setError(null);
    const r = await callAction(runBackupNowAction());
    if (r.ok) { toast(tr("أُخذت نسخة احتياطية")); router.refresh(); } else { setError(actionErrorText(errors, r)); router.refresh(); }
  });

  return (
    <div className="surface space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-subtle text-slate-700"><CalendarClock className="size-5 stroke-[1.75]" /></span>
          <div className="space-y-1">
            <h3 className="text-[18.5px] font-semibold text-ink">{tr("النسخ الاحتياطي التلقائي")}</h3>
            <p className="max-w-xl text-[16.5px] leading-relaxed text-slate-600">{tr("نسخة كاملة كل يوم في المجلد المحدد. إن كان الجهاز مطفأً وقت النسخ تؤخذ النسخة عند تشغيله.")}</p>
          </div>
        </div>
        <Button variant="outline" loading={running} onClick={runNow}><Play />{tr("نسخة الآن")}</Button>
      </div>

      {status.last_error && (!status.last_success_at || (status.last_attempt_at ?? "") > status.last_success_at) && (
        <Alert variant="destructive">{tr("فشلت آخر محاولة نسخ: {0}", status.last_error)}</Alert>
      )}
      {stale && !status.last_error && <Alert variant="destructive">{status.last_success_at ? tr("مر أكثر من يوم دون نسخة احتياطية") : tr("لم تؤخذ أي نسخة احتياطية بعد")}</Alert>}
      {error && <Alert variant="destructive">{error}</Alert>}

      <div className="flex flex-wrap items-center gap-2 text-[15.5px]">
        <span className="text-slate-500">{tr("آخر نسخة")}</span>
        {status.last_success_at ? <span className="num font-semibold text-ink">{when(status.last_success_at)}</span> : <span className="text-slate-500">{tr("لا يوجد")}</span>}
        {settings.enabled ? <Badge variant="success">{tr("مفعّل يوميًا {0}", settings.time)}</Badge> : <Badge variant="secondary">{tr("متوقف")}</Badge>}
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_120px_120px]">
        <div className="space-y-1.5"><Label htmlFor="backup_folder">{tr("مجلد النسخ")}</Label>
          <Input id="backup_folder" dir="ltr" value={v.folder} onChange={(e) => setV({ ...v, folder: e.target.value })} /></div>
        <div className="space-y-1.5"><Label htmlFor="backup_time">{tr("وقت النسخ")}</Label>
          <Input id="backup_time" type="time" dir="ltr" value={v.time} onChange={(e) => setV({ ...v, time: e.target.value })} /></div>
        <div className="space-y-1.5"><Label htmlFor="backup_keep">{tr("عدد النسخ المحفوظة")}</Label>
          <Input id="backup_keep" inputMode="numeric" dir="ltr" value={v.keep} onChange={(e) => setV({ ...v, keep: e.target.value })} /></div>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} />{tr("تفعيل النسخ اليومي")}</label>
        <Button loading={pending} onClick={save}>{tr("حفظ الإعدادات")}</Button>
      </div>

      {files.length > 0 && (
        <div className="divide-y divide-line rounded-lg border border-line">
          {files.map((f) => (
            <div key={f.name} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="num min-w-0 truncate text-[15px] text-ink" dir="ltr">{f.name}</span>
              <span className="flex items-center gap-3">
                <span className="num text-[14px] text-slate-500">{mb(f.size)}</span>
                <Button asChild variant="ghost" size="sm"><a href={`/api/backup?file=${encodeURIComponent(f.name)}`} download aria-label={tr("تنزيل {0}", f.name)}><Download className="size-4" /></a></Button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
