import { cn } from "@/lib/utils";
import { CurrencyTag } from "./currency-tag";

type Tone = "ink" | "teal" | "clay" | "neutral";
const TONES: Record<Tone, string> = {
  ink: "bg-ink text-white",
  teal: "bg-accent1-tint text-accent1",
  clay: "bg-accent2-tint text-accent2",
  neutral: "bg-subtle text-slate-700",
};

/** صف بطاقات ملخص أعلى الصفحات (أرقام محسوبة من نفس بيانات الجدول المعروض) */
export function StatGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn("stat-grid mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4", className)}>{children}</section>;
}

export function Stat({
  icon: Icon, label, value, hint, tone = "neutral", currency, valueClassName,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: Tone;
  /** رمز العملة إن كانت القيمة مبلغًا، يظهر اسمها كشارة في الزاوية بدل رمز بجانب الرقم */
  currency?: string;
  valueClassName?: string;
}) {
  return (
    <div className="surface lift min-w-0 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <span className={cn("lift-icon flex size-9 shrink-0 items-center justify-center rounded-[10px]", TONES[tone])}>
          <Icon className="size-[17px] stroke-[1.9]" />
        </span>
        <p className="line-clamp-2 min-w-0 text-[16.5px] leading-tight font-medium text-slate-600">{label}</p>
        {currency && <CurrencyTag code={currency} className="ms-auto" />}
      </div>
      <p className={cn("display-num mt-3 truncate text-[24px] font-bold leading-tight text-ink", valueClassName)}>{value}</p>
      {hint && <p className="mt-1 truncate text-[15.5px] text-slate-500">{hint}</p>}
    </div>
  );
}
