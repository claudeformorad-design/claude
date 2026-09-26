import Link from "@/components/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ZERO, toMoney } from "@/lib/accounting/money";
import { listBills, listVendors } from "@/services/payables.service";
import { getI18n } from "@/i18n/server";
import { AlarmClock, FileSpreadsheet, Hourglass, Receipt } from "lucide-react";
import { Stat, StatGrid } from "@/components/ui/stat";
import { EntityCell } from "@/components/ui/entity";
import { EmptyState } from "@/components/ui/empty-state";
import { todayInTimeZone } from "@/lib/accounting/fiscal";

export default async function BillsPage({ searchParams }: { searchParams: Promise<{ vendor?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.billsView);
  const { locale, t } = await getI18n();
  const sp = await searchParams;
  const [bills, vendors] = await Promise.all([listBills(ctx.supabase, ctx.hotel.id, sp.vendor), listVendors(ctx.supabase, ctx.hotel.id)]);
  const today = todayInTimeZone(ctx.hotel.timezone);
  const vName = new Map(vendors.map((v) => [v.id, (locale === "en" && v.name_en) || v.name_ar]));
  return (
    <>
      <PageHeader title={t.nav.bills} description={t.payables.billsSubtitle}
        actions={ctx.can(PERMISSIONS.billsCreate) && <Button asChild><Link href="/bills/new"><Plus />{t.payables.newBill}</Link></Button>} />
      <StatGrid>
        <Stat icon={FileSpreadsheet} tone="ink" label="فواتير الموردين" value={<span className="num">{bills.length}</span>} />
        <Stat icon={Receipt} tone="teal" label="إجمالي المشتريات" value={<Money value={bills.reduce((a, b) => a.plus(toMoney(b.total)), ZERO)} locale={locale} />} />
        <Stat icon={Hourglass} tone="clay" label="المستحق للموردين" value={<Money value={bills.reduce((a, b) => a.plus(toMoney(b.total).minus(toMoney(b.amount_paid))), ZERO)} locale={locale} />} />
        <Stat icon={AlarmClock} tone="neutral" label="متأخرة السداد" value={<span className="num">{bills.filter((b) => b.due_date < today && toMoney(b.total).gt(toMoney(b.amount_paid))).length}</span>} />
      </StatGrid>
      <Card className="overflow-hidden">
        <Table>
          <TableHeader><TableRow>
            <TableHead>{t.payables.billNumber}</TableHead><TableHead>{t.payables.vendorInvoiceNo}</TableHead><TableHead>{t.payables.vendor}</TableHead>
            <TableHead>{t.common.date}</TableHead><TableHead>{t.invoices.dueDate}</TableHead>
            <TableHead className="text-end">{t.invoices.total}</TableHead><TableHead className="text-end">{t.invoices.outstanding}</TableHead><TableHead>{t.common.status}</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {bills.length === 0 && <TableRow><TableCell colSpan={8} className="py-8"><EmptyState title="لا توجد فواتير موردين" description="سجّل فواتير المشتريات والخدمات لتظهر هنا مع مستحقاتها ومواعيد سدادها." actionHref="/bills/new" actionLabel="فاتورة مورد جديدة" icon={FileSpreadsheet} /></TableCell></TableRow>}
            {bills.map((b) => (
              <TableRow key={b.id}>
                <TableCell><Link href={`/bills/${b.id}`} className="num font-semibold text-ink hover:underline">{b.bill_number}</Link></TableCell>
                <TableCell className="num">{b.vendor_invoice_no ?? "—"}</TableCell>
                <TableCell><EntityCell name={vName.get(b.vendor_id) ?? "—"} /></TableCell>
                <TableCell className="num">{b.bill_date}</TableCell><TableCell className={`num ${b.due_date < today && toMoney(b.total).gt(toMoney(b.amount_paid)) ? "font-semibold text-urgent" : ""}`}>{b.due_date}</TableCell>
                <TableCell className="text-end font-semibold"><Money value={b.total} locale={locale} /></TableCell>
                <TableCell className="text-end"><Money value={toMoney(b.total).minus(toMoney(b.amount_paid))} locale={locale} blankZero /></TableCell>
                <TableCell><Badge variant={b.status === "paid" ? "success" : b.status === "partially_paid" ? "info" : "warning"}>{t.payables.statuses[b.status]}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
