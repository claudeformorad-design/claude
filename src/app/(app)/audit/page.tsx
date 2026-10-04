import { tr } from "@/i18n/tr";
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

const ACTION_AR: Record<string, string> = { get INSERT() { return tr("إضافة"); }, get UPDATE() { return tr("تعديل"); }, get DELETE() { return tr("حذف"); } };
const TABLE_AR: Record<string, string> = {
  get journal_entries() { return tr("القيود"); }, get journal_entry_lines() { return tr("أسطر القيود"); }, get chart_of_accounts() { return tr("دليل الحسابات"); }, get accounting_periods() { return tr("الفترات"); },
  get fiscal_years() { return tr("السنوات المالية"); }, get guest_folios() { return tr("الفوليو"); }, get folio_transactions() { return tr("حركات الفوليو"); }, get invoices() { return tr("الفواتير"); }, get payments() { return tr("السندات"); },
  get customers() { return tr("العملاء"); }, get vendors() { return tr("الموردون"); }, get vendor_bills() { return tr("فواتير الموردين"); }, get purchase_orders() { return tr("أوامر الشراء"); }, get payroll_runs() { return tr("الرواتب"); },
  get fixed_assets() { return tr("الأصول الثابتة"); }, get inventory_items() { return tr("أصناف المخزون"); }, get inventory_movements() { return tr("حركات المخزون"); }, get hotels() { return tr("بيانات الفندق"); },
  get departments() { return tr("الأقسام"); }, get charge_codes() { return tr("رموز الإيراد"); }, get tax_rates() { return tr("الضرائب"); }, get payment_methods() { return tr("طرق الدفع"); }, get hotel_members() { return tr("المستخدمون"); }, get cashier_shifts() { return tr("ورديات الكاشير"); },
  get user_hotel_roles() { return tr("أدوار المستخدمين"); }, get roles() { return tr("الأدوار"); }, get bank_statement_lines() { return tr("كشوف البنك"); },
  get maintenance_requests() { return tr("بلاغات الصيانة"); }, get maintenance_assets() { return tr("سجل الأجهزة"); }, get maintenance_parts() { return tr("قطع الغيار"); },
  get lost_found_items() { return tr("المفقودات"); }, get safe_deposits() { return tr("أمانات الخزنة"); }, get laundry_items() { return tr("أسعار المغسلة"); },
  get laundry_orders() { return tr("طلبات الغسيل"); }, get linen_movements() { return tr("حركات المفروشات"); }, get event_bookings() { return tr("المناسبات"); },
  get event_tasks() { return tr("مهام التجهيز"); }, get guest_surveys() { return tr("تقييمات النزلاء"); },
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
      <PageHeader title={t.nav.audit} />
      <StatGrid>
        <Stat icon={History} tone="ink" label={tr("أحداث في الصفحة")} value={<span className="num">{rows.length}</span>} />
        <Stat icon={PlusCircle} tone="teal" label={tr("إضافات")} value={<span className="num">{rows.filter((r) => r.action === "INSERT").length}</span>} />
        <Stat icon={Pencil} tone="clay" label={tr("تعديلات")} value={<span className="num">{rows.filter((r) => r.action === "UPDATE").length}</span>} />
        <Stat icon={Trash2} tone="neutral" label={tr("حذف")} value={<span className="num">{rows.filter((r) => r.action === "DELETE").length}</span>} />
      </StatGrid>
      <form className="toolbar">
        <Input name="table" defaultValue={sp.table} placeholder={tr("اسم الجدول")} dir="ltr" className="w-72" />
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
                <TableCell>{r.actor_name ? <EntityCell name={r.actor_name} /> : <span className="text-slate-400">{tr("النظام")}</span>}</TableCell>
                <TableCell className="whitespace-nowrap font-medium">{TABLE_AR[r.table_name ?? ""] ?? r.table_name}</TableCell>
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
        {page > 0 && <Button asChild variant="outline"><a href={`?page=${page - 1}${sp.table ? `&table=${sp.table}` : ""}`}>{tr("السابق")}</a></Button>}
        {(data ?? []).length === 100 && <Button asChild variant="outline"><a href={`?page=${page + 1}${sp.table ? `&table=${sp.table}` : ""}`}>{tr("التالي")}</a></Button>}
      </div>
    </>
  );
}
