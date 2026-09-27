import {
  BedDouble, BookOpen, Boxes, Building2, FilePen, FileSpreadsheet, FileText, Flag, Lock, Receipt, Scale, Undo2, UserCog, Wallet,
} from "lucide-react";
import Link from "@/components/link";
import { Money } from "@/components/money";

const SOURCE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  manual: FilePen, opening: Flag, reversal: Undo2, closing: Lock, adjustment: Scale, folio: BedDouble, invoice: FileText,
  payment: Receipt, vendor_bill: FileSpreadsheet, expense: Wallet, payroll: UserCog, depreciation: Building2,
  inventory: Boxes, petty_cash: Wallet, cashier_shift: Wallet,
};

export type RecentEntry = { id: string; entry_number: string | null; entry_date: string; description: string; source: string; total: string };

const dayLabel = (d: string, today: string) => {
  const diff = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86_400_000);
  if (diff === 0) return "اليوم";
  if (diff === 1) return "أمس";
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })
    .format(new Date(`${d}T00:00:00Z`));
};

/** الوصف الآلي «نوع — مرجع (اسم)» يُقسم إلى عنوان قصير وسطر تفاصيل */
function splitDescription(text: string): [string, string | null] {
  const i = text.indexOf(" — ");
  return i < 0 ? [text, null] : [text.slice(0, i), text.slice(i + 3)];
}

/**
 * آخر القيود المرحّلة: مجمّعة حسب اليوم (اليوم، أمس، ثم التاريخ)، لكل قيد أيقونة مصدره،
 * وعنوان قصير واضح، وسطر تفاصيل هادئ، والمبلغ في النهاية ورقم القيد تحته.
 */
export function RecentEntries({ entries, today, sources }: { entries: RecentEntry[]; today: string; sources: Record<string, string> }) {
  const days = [...new Set(entries.map((e) => e.entry_date))];
  return (
    <div className="-mx-2 space-y-4">
      {days.map((d) => (
        <section key={d}>
          <h3 className="mb-1 px-2 text-[14px] font-semibold text-slate-500">{dayLabel(d, today)}</h3>
          <ul className="space-y-0.5">
            {entries.filter((e) => e.entry_date === d).map((e) => {
              const Icon = SOURCE_ICON[e.source] ?? BookOpen;
              const [title, detail] = splitDescription(e.description);
              return (
                <li key={e.id}>
                  <Link href={`/journal/${e.id}`} className="group flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-panel">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-line bg-white text-slate-600 transition-colors group-hover:border-action/30 group-hover:text-action">
                      <Icon className="size-[17px] stroke-[1.8]" />
                    </span>
                    <span className="min-w-0 flex-1 leading-snug">
                      <span className="block truncate text-[16px] font-medium text-ink">{title}</span>
                      <span className="block truncate text-[14px] text-slate-500">{detail ?? sources[e.source] ?? e.source}</span>
                    </span>
                    <span className="shrink-0 text-end leading-snug">
                      <span className="block text-[16px] font-semibold text-ink"><Money value={e.total} locale="ar" /></span>
                      <span className="num block text-[13px] text-slate-500">{e.entry_number}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
