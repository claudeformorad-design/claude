import { currencyName } from "@/lib/currency-name";
import { cn } from "@/lib/utils";

/** شارة العملة: اسمها نصًا بخط الواجهة، صغيرة وهادئة في زاوية البطاقة */
export function CurrencyTag({ code, className }: { code: string; className?: string }) {
  return (
    <span className={cn("shrink-0 whitespace-nowrap rounded-md bg-subtle px-2 py-0.5 font-sans text-[14px] font-medium text-slate-600", className)}>
      {currencyName(code)}
    </span>
  );
}
