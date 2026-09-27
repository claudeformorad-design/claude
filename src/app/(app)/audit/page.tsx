import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getI18n } from "@/i18n/server";
import { formatDateTime } from "@/lib/accounting/fiscal";
import { History, Pencil, PlusCircle, Trash2 } from "lucide-react";
import { Stat, StatGrid } from "@/components/ui/stat";
import { EntityCell } from "@/components/ui/entity";

const ACTION_AR: Record<string, string> = { INSERT: "إضافة", UPDATE: "تعديل", DELETE: "حذف" };
const TABLE_AR: Record<string, string> = {
  journal_entries: "القيود", journal_entry_lines: "أسطر القيود", chart_of_accounts: "دليل الحسابات", accounting_periods: "الفترات",
  fiscal_years: "السنوات المالية", guest_folios: "الفوليو", folio_transactions: "حركات الفوليو", invoices: "الفواتير", payments: "السندات",
  customers: "العملاء", vendors: "الموردون", vendor_bills: "فواتير الموردين", purchase_orders: "أوامر الشراء", payroll_runs: "الرواتب",
  fixed_assets: "الأصول الثابتة", inventory_items: "أصناف المخزون", inventory_movements: "حركات المخزون", hotels: "بيانات الفندق",
  departments: "الأقسام", charge_codes: "رموز الإيراد", tax_rates: "الضرائب", payment_methods: "طرق الدفع", hotel_members: "المستخدمون", cashier_shifts: "ورديات الكاشير",
  user_hotel_roles: "أدوار المستخدمين", roles: "الأدوار", bank_statement_lines: "كشوف البنك",
};

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ table?: string; page?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.auditView);
  const { t } = await getI18n();
  const sp = await searchParams;
  const page = Math.max(0, Number(sp.page ?? 0) || 0);
  let q = ctx.supabase.from("audit_log_view").select("*").eq("hotel_id", ctx.hotel.id).order("occurred_at", { ascending: false }).range(page * 100, page * 100 + 99);
  if (sp.table) q = q.eq("table_name", sp.table.trim());
  const { data } = await q;
  const a = t.admin;
  const rows = data ?? [];
  return (
    <>
      <PageHeader title={t.nav.audit} description={a.auditSubtitle} />
      <StatGrid>
        <Stat icon={History} tone="ink" label="أحداث في الصفحة" value={<span className="num">{rows.length}</span>} />
        <Stat icon={PlusCircle} tone="teal" label="إضافات" value={<span className="num">{rows.filter((r) => r.action === "INSERT").length}</span>} />
        <Stat icon={Pencil} tone="clay" label="تعديلات" value={<span className="num">{rows.filter((r) => r.action === "UPDATE").length}</span>} />
        <Stat icon={Trash2} tone="neutral" label="حذف" value={<span className="num">{rows.filter((r) => r.action === "DELETE").length}</span>} />
      </StatGrid>
      <form className="toolbar">
        <Input name="table" defaultValue={sp.table} placeholder="اسم الجدول (مثل journal_entries)" dir="ltr" className="w-72" />
        <Button type="submit" variant="outline">{t.common.apply}</Button>
      </form>
      <Card className="overflow-hidden">
        <Table>
          <TableHeader><TableRow>
            <TableHead>{t.common.date}</TableHead><TableHead>{a.actor}</TableHead><TableHead>{a.table}</TableHead><TableHead>{a.action}</TableHead><TableHead>{a.changed}</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="num whitespace-nowrap">{formatDateTime(r.occurred_at, ctx.hotel.timezone, true)}</TableCell>
                <TableCell>{r.actor_name ? <EntityCell name={r.actor_name} /> : <span className="text-slate-400">النظام</span>}</TableCell>
                <TableCell><span className="font-medium">{TABLE_AR[r.table_name ?? ""] ?? r.table_name}</span>{TABLE_AR[r.table_name ?? ""] && <span className="num block text-[14.5px] text-slate-500">{r.table_name}</span>}</TableCell>
                <TableCell><Badge variant={r.action === "DELETE" ? "destructive" : r.action === "INSERT" ? "success" : "warning"}>{ACTION_AR[r.action ?? ""] ?? r.action}</Badge></TableCell>
                <TableCell className="max-w-md">
                  {r.action === "UPDATE" ? (
                    <details><summary className="cursor-pointer num">{(r.changed_fields ?? []).join(", ")}</summary>
                      <pre dir="ltr" className="mt-1 max-h-48 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(
                        Object.fromEntries((r.changed_fields ?? []).map((f) => [f, { from: (r.old_data as Record<string, unknown>)?.[f], to: (r.new_data as Record<string, unknown>)?.[f] }])), null, 1)}</pre>
                    </details>
                  ) : <span className="num text-xs text-muted-foreground">{r.record_id}</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <div className="mt-4 flex gap-2">
        {page > 0 && <Button asChild variant="outline"><a href={`?page=${page - 1}${sp.table ? `&table=${sp.table}` : ""}`}>←</a></Button>}
        {(data ?? []).length === 100 && <Button asChild variant="outline"><a href={`?page=${page + 1}${sp.table ? `&table=${sp.table}` : ""}`}>→</a></Button>}
      </div>
    </>
  );
}
