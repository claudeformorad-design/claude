import { tr, currentLocale } from "@/i18n/tr";
import {
  ArrowLeftRight, BedDouble, BookOpen, Boxes, Building2, FilePen, FileSpreadsheet, FileText, Flag, Handshake, Landmark, Lock, Receipt, Scale, Undo2, UserCog, Wallet,
} from "lucide-react";
import Link from "@/components/link";
import { Money } from "@/components/money";
import { DocText } from "@/components/ui/code-text";
import { plainText } from "@/lib/text";

const SOURCE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  manual: FilePen, opening: Flag, reversal: Undo2, closing: Lock, adjustment: Scale, folio: BedDouble, invoice: FileText,
  payment: Receipt, vendor_bill: FileSpreadsheet, expense: Wallet, payroll: UserCog, depreciation: Building2,
  inventory: Boxes, petty_cash: Wallet, cashier_shift: Wallet, cheque: Landmark, commission: Handshake, fund_transfer: ArrowLeftRight, fx_revaluation: Scale,
};

export type RecentEntry = { id: string; entry_number: string | null; entry_date: string; description: string; source: string; total: string };

const dayLabel = (d: string, today: string) => {
  const diff = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86_400_000);
  if (diff === 0) return tr("اليوم");
  if (diff === 1) return tr("أمس");
  return new Intl.DateTimeFormat(currentLocale() === "en" ? "en-GB" : "ar-SA-u-ca-gregory-nu-latn", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })
    .format(new Date(`${d}T00:00:00Z`));
};

/** الوصف الآلي «نوع، مرجع واسم» يُقسم إلى عنوان قصير وسطر تفاصيل بلا رموز فاصلة */
function splitDescription(text: string): [string, string | null] {
  const i = text.search(/\s[—–]\s/);
  return i < 0 ? [plainText(text), null] : [plainText(text.slice(0, i)), plainText(text.slice(i + 3))];
}

/**
 * آخر القيود المرحّلة: مجمّعة حسب اليوم (اليوم، أمس، ثم التاريخ)، وكل قيد سطر واحد هادئ:
 * نقطة مصدره الملونة بأيقونة صغيرة، ووصف قصير، والمبلغ في النهاية.
 */
export function RecentEntries({ entries, today, sources }: { entries: RecentEntry[]; today: string; sources: Record<string, string> }) {
  const days = [...new Set(entries.map((e) => e.entry_date))];
  return (
    <div className="-mx-2 space-y-4">
      {days.map((d) => (
        <section key={d}>
          <h3 className="mb-1 px-2 text-[15px] text-slate-500">{dayLabel(d, today)}</h3>
          <ul>
            {entries.filter((e) => e.entry_date === d).map((e) => {
              const Icon = SOURCE_ICON[e.source] ?? BookOpen;
              const [title] = splitDescription(e.description);
              return (
                <li key={e.id}>
                  <Link href={`/journal/${e.id}`} title={`${e.entry_number ?? ""} ${sources[e.source] ?? ""}`.trim()}
                    className="group flex items-center gap-3 rounded-lg px-2 py-2.5 text-[16px] transition-colors hover:bg-subtle">
                    <Icon className="size-[18px] shrink-0 stroke-[1.7] text-slate-400 transition-colors group-hover:text-action" />
                    <DocText text={title} className="min-w-0 flex-1 truncate text-ink" />
                    <Money value={e.total} locale="ar" className="shrink-0 font-semibold text-ink" />
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
