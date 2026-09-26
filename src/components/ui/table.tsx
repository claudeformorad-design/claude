import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * الجدول المعتمد: رأس داكن بنص أبيض عريض، صفوف بخطوط رفيعة، ومسافات تتبع إعداد الكثافة
 * (مريح/مضغوط — data-density على <html>).
 */
export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div data-slot="table" className="relative w-full overflow-x-auto rounded-lg border border-line bg-white">
      <table className={cn("w-full caption-bottom border-collapse text-[16px]", className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("bg-thead text-[15px] text-thead-text [&_tr]:border-0 [&_tr]:hover:bg-thead", className)} {...props} />;
}

export function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("rows-animate [&_tr:last-child]:border-0", className)} {...props} />;
}

export function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return <tfoot className={cn("border-t border-line-strong bg-group-row text-[16px] font-bold text-ink [&_tr]:hover:bg-group-row", className)} {...props} />;
}

export function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={cn("border-b border-line transition-colors duration-150 hover:bg-[#fbfaf7]", className)} {...props} />;
}

export function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return <th className={cn("th-cell whitespace-nowrap px-5 text-start align-middle font-bold first:ps-6 last:pe-6", className)} {...props} />;
}

export function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("td-cell px-5 align-middle text-ink first:ps-6 last:pe-6", className)} {...props} />;
}
