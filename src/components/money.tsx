import { formatMoney, type MoneyInput, toMoney } from "@/lib/accounting/money";
import { cn } from "@/lib/utils";

/** عرض مبلغ مالي بأرقام متساوية العرض؛ الصفر يُعرض كشرطة لتسهيل القراءة في الجداول */
export function Money({
  value,
  locale,
  decimals = 2,
  blankZero = false,
  className,
}: {
  value: MoneyInput;
  locale: string;
  decimals?: number;
  blankZero?: boolean;
  className?: string;
}) {
  const zero = toMoney(value).isZero();
  return (
    <span className={cn("num", zero && blankZero && "text-muted-foreground", className)}>
      {zero && blankZero ? "" : formatMoney(value, { locale, decimals })}
    </span>
  );
}
