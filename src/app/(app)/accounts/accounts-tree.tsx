"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import Link from "@/components/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DensityToggle } from "@/components/ui/density-toggle";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type TreeRow = {
  id: string;
  code: string;
  name: string;
  depth: number;
  parentId: string | null;
  isPostable: boolean;
  isActive: boolean;
  typeLabel: string;
  sideLabel: string;
};

const INDENT = 22;

/**
 * شجرة الحسابات: رأس داكن، صفوف المجموعات الرئيسية رمادية، كل حساب تجميعي قابل للطي،
 * وخطوط إرشادية رأسية تبيّن مستوى كل حساب. توسيع/طي الكل وكثافة مريح/مضغوط.
 */
export function AccountsTree({ rows, canManage, density, labels }: {
  rows: TreeRow[];
  canManage: boolean;
  density: "comfortable" | "compact";
  labels: { code: string; name: string; type: string; side: string; status: string; actions: string; header: string; detail: string; edit: string };
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const parentOf = useMemo(() => new Map(rows.map((r) => [r.id, r.parentId])), [rows]);
  const headerIds = useMemo(() => rows.filter((r) => !r.isPostable).map((r) => r.id), [rows]);
  const isHidden = (r: TreeRow) => {
    for (let p = r.parentId; p; p = parentOf.get(p) ?? null) if (collapsed.has(p)) return true;
    return false;
  };
  const flip = (id: string) => setCollapsed((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-baseline gap-2">
          <span className="type-title text-[22px] text-ink">شجرة الحسابات</span>
          <span className="num text-[16.5px] text-slate-500">{rows.length} حساب</span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setCollapsed(new Set())}>توسيع الكل</Button>
          <Button variant="ghost" size="sm" onClick={() => setCollapsed(new Set(headerIds))}>طي الكل</Button>
          <DensityToggle initial={density} />
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-32">{labels.code}</TableHead>
            <TableHead className="border-e border-white/15">{labels.name}</TableHead>
            <TableHead>{labels.type}</TableHead>
            <TableHead>{labels.side}</TableHead>
            <TableHead>{labels.status}</TableHead>
            {canManage && <TableHead className="text-end">{labels.actions}</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.filter((r) => !isHidden(r)).map((r) => {
            const isOpen = !collapsed.has(r.id);
            return (
              <TableRow key={r.id} className={cn(r.depth === 0 && "bg-group-row hover:bg-group-row", !r.isActive && "opacity-50")}>
                <TableCell className={cn("num", r.isPostable ? "text-slate-600" : "font-bold text-ink")}>{r.code}</TableCell>
                <TableCell className="relative border-e border-line" style={{ paddingInlineStart: 24 + r.depth * INDENT }}>
                  {/* خطوط إرشادية لكل مستوى أعلى */}
                  {Array.from({ length: r.depth }, (_, i) => (
                    <span key={i} aria-hidden className="absolute inset-y-0 w-px bg-line-strong"
                      style={{ insetInlineStart: 24 + i * INDENT + 7 }} />
                  ))}
                  <span className="relative flex items-center gap-2">
                    {!r.isPostable ? (
                      <button type="button" onClick={() => flip(r.id)} aria-expanded={isOpen} aria-label={isOpen ? "طي" : "توسيع"}
                        className="flex size-6 shrink-0 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-subtle hover:text-ink">
                        <ChevronDown className={cn("size-4 transition-transform duration-200", !isOpen && "rotate-90")} />
                      </button>
                    ) : <span className="w-6 shrink-0" />}
                    <span className={cn(r.isPostable ? "text-ink" : "font-bold text-ink")}>{r.name}</span>
                  </span>
                </TableCell>
                <TableCell className="text-slate-700">{r.typeLabel}</TableCell>
                <TableCell className="text-slate-700">{r.sideLabel}</TableCell>
                <TableCell>
                  {r.isPostable ? <Badge variant="outline">{labels.detail}</Badge> : <Badge variant="solid">{labels.header}</Badge>}
                </TableCell>
                {canManage && (
                  <TableCell className="whitespace-nowrap text-end">
                    {!r.isPostable && (
                      <Button asChild variant="ghost" size="sm" aria-label="حساب فرعي جديد">
                        <Link href={`/accounts?new=1&parent=${r.id}`}><Plus /></Link>
                      </Button>
                    )}
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/accounts?edit=${r.id}`}>{labels.edit}</Link>
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
