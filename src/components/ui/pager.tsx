import Link from "@/components/link";
import { cn } from "@/lib/utils";

export const PAGE_SIZE = 50;

/** شريحة الصفحة الحالية من قائمة (الملخصات تُحسب من القائمة كاملة، والعرض 50 صفًا فقط) */
export function pageSlice<T>(rows: T[], page: string | undefined): { rows: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const p = Math.min(Math.max(1, Number(page) || 1), pages);
  return { rows: rows.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE), page: p, pages };
}

/** تنقّل بين الصفحات مع الحفاظ على بقية عوامل التصفية في الرابط */
export function Pager({ page, pages, total, basePath, params }: {
  page: number;
  pages: number;
  total: number;
  basePath: string;
  params: Record<string, string | undefined>;
}) {
  if (pages <= 1) return null;
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== "page") q.set(k, v);
    if (p > 1) q.set("page", String(p));
    const s = q.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const from = (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  const btn = "flex h-9 items-center gap-1 rounded-md border border-line bg-white px-3 text-[15.5px] font-medium text-ink transition-colors hover:bg-panel";
  return (
    <nav className="mt-4 flex items-center justify-between gap-3" aria-label="الصفحات">
      <p className="text-[15px] text-slate-600">
        من <span className="num">{from}</span> إلى <span className="num">{to}</span> من أصل <span className="num">{total}</span>
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? <Link href={href(page - 1)} className={btn}>السابق</Link>
          : <span className={cn(btn, "pointer-events-none opacity-40")}>السابق</span>}
        <span className="px-1 text-[15px] text-slate-600">صفحة <span className="num">{page}</span> من <span className="num">{pages}</span></span>
        {page < pages ? <Link href={href(page + 1)} className={btn}>التالي</Link>
          : <span className={cn(btn, "pointer-events-none opacity-40")}>التالي</span>}
      </div>
    </nav>
  );
}
