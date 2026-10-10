import { Card } from "./card";
import { cn } from "@/lib/utils";

export type Property = [label: string, value: React.ReactNode];

/** خصائص السجل على نمط نوشن: تسمية باهتة فوق قيمة واضحة، وتُخفى الخاصية الفارغة */
export function Properties({ items, className }: { items: Property[]; className?: string }) {
  const shown = items.filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== false);
  if (!shown.length) return null;
  return (
    <Card className={cn("mb-6", className)}>
      <dl className="grid gap-x-8 gap-y-5 p-6 sm:grid-cols-2 lg:grid-cols-4">
        {shown.map(([label, value]) => (
          <div key={label} className="min-w-0 border-s-2 border-line ps-3">
            <dt className="text-[15.5px] text-slate-500">{label}</dt>
            <dd className="mt-0.5 font-semibold text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
