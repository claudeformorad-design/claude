import { tr } from "@/i18n/tr";
import { ShieldCheck } from "lucide-react";

export type Summary = { hotels: string[]; reservations: number; entries: number; last_entry_date: string | null; last_activity: string | null; migrations: number };

/** نتيجة فحص نسخة: الملف سليم ويُفتح، وما فيه من بيانات */
export function BackupSummaryView({ title, summary }: { title: string; summary: Summary }) {
  return (
    <div className="space-y-2 rounded-lg border border-success/40 bg-success/5 p-4 text-[15.5px]">
      <p className="flex items-center gap-2 font-semibold text-success"><ShieldCheck className="size-5" />{tr("النسخة سليمة وتُستعاد")}</p>
      <p className="num text-[14px] text-slate-500" dir="ltr">{title}</p>
      <ul className="space-y-1 text-slate-700">
        <li>{tr("الفنادق:")} <span className="font-semibold text-ink">{summary.hotels.join("، ") || tr("لا يوجد")}</span></li>
        <li>{tr("الحجوزات:")} <span className="num font-semibold text-ink">{summary.reservations}</span></li>
        <li>{tr("القيود:")} <span className="num font-semibold text-ink">{summary.entries}</span>
          {summary.last_entry_date && <>{tr("، آخرها بتاريخ")} <span className="num font-semibold text-ink">{summary.last_entry_date}</span></>}</li>
      </ul>
    </div>
  );
}
