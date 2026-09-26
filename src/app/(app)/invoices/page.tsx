import Link from "@/components/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ZERO, toMoney } from "@/lib/accounting/money";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { listInvoices } from "@/services/invoices.service";
import { getI18n } from "@/i18n/server";
import { InvoiceStatusBadge } from "./status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { AlarmClock, FileText, Hourglass, Receipt } from "lucide-react";
import { Stat, StatGrid } from "@/components/ui/stat";
import { EntityCell } from "@/components/ui/entity";
import { FilterTabs } from "@/components/ui/filter-tabs";

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; customer?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.invoicesView);
  const { locale, t } = await getI18n();
  const sp = await searchParams;
  const invoices = await listInvoices(ctx.supabase, ctx.hotel.id, { status: sp.status, q: sp.q, customerId: sp.customer });

  const today = todayInTimeZone(ctx.hotel.timezone);
  const outstanding = (i: (typeof invoices)[number]) => toMoney(i.amount_due).minus(toMoney(i.amount_paid));
  const totalInvoiced = invoices.reduce((a, i) => a.plus(toMoney(i.total)), ZERO);
  const totalOutstanding = invoices.reduce((a, i) => a.plus(outstanding(i)), ZERO);
  const overdue = invoices.filter((i) => i.due_date && i.due_date < today && outstanding(i).gt(0));
  const qs = (st?: string) => {
    const p = new URLSearchParams();
    if (st) p.set("status", st);
    if (sp.q) p.set("q", sp.q);
    if (sp.customer) p.set("customer", sp.customer);
    const q = p.toString();
    return q ? `/invoices?${q}` : "/invoices";
  };

  return (
    <>
      <PageHeader
        title={t.invoices.title}
        description={t.invoices.subtitle}
        actions={ctx.can(PERMISSIONS.invoicesCreate) && (
          <Button asChild><Link href="/invoices/new"><Plus />{t.invoices.newDirect}</Link></Button>
        )}
      />
      <StatGrid>
        <Stat icon={FileText} tone="ink" label="فواتير في القائمة" value={<span className="num">{invoices.length}</span>} />
        <Stat icon={Receipt} tone="teal" label="إجمالي المفوتر" value={<Money value={totalInvoiced} locale={locale} />} />
        <Stat icon={Hourglass} tone="clay" label="المتبقي للتحصيل" value={<Money value={totalOutstanding} locale={locale} />} />
        <Stat icon={AlarmClock} tone="neutral" label="متأخرة السداد" value={<span className="num">{overdue.length}</span>}
          hint={overdue.length ? <>بقيمة <Money value={overdue.reduce((a, i) => a.plus(outstanding(i)), ZERO)} locale={locale} /></> : "لا يوجد تأخير"} />
      </StatGrid>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <FilterTabs active={sp.status ?? "all"} items={[
          { key: "all", href: qs(), label: "الكل" },
          ...(["issued", "partially_paid", "paid"] as const).map((k) => ({ key: k, href: qs(k), label: t.invoices.statuses[k] })),
        ]} />
        <form className="flex items-center gap-2">
          {sp.status && <input type="hidden" name="status" value={sp.status} />}
          <Input name="q" defaultValue={sp.q} placeholder="ابحث برقم الفاتورة أو الاسم" className="w-64 bg-white" />
          <Button type="submit" variant="outline">{t.common.apply}</Button>
        </form>
      </div>
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.invoices.invoiceNumber}</TableHead>
              <TableHead>{t.invoices.issueDate}</TableHead>
              <TableHead>{t.invoices.billTo}</TableHead>
              <TableHead>{t.common.status}</TableHead>
              <TableHead className="text-end">{t.invoices.total}</TableHead>
              <TableHead className="text-end">{t.invoices.outstanding}</TableHead>
              <TableHead>{t.invoices.dueDate}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8">
                  <EmptyState
                    title="لا توجد فواتير ضريبية صادرة"
                    description="لم يتم إصدار أي فاتورة ضريبية بعد. يمكنك إصدار فاتورة مباشرة للنزلاء أو الشركات."
                    actionHref="/invoices/new"
                    actionLabel="إصدار فاتورة جديدة"
                    icon={FileText}
                  />
                </TableCell>
              </TableRow>
            )}
            {invoices.map((i) => (
              <TableRow key={i.id}>
                <TableCell>
                  <Link href={`/invoices/${i.id}`} className="num block font-semibold text-ink hover:underline">{i.invoice_number}</Link>
                  <span className="text-[12px] text-slate-500">{t.invoices.types[i.invoice_type]}</span>
                </TableCell>
                <TableCell className="num">{i.issue_date}</TableCell>
                <TableCell><EntityCell name={i.bill_to_name} /></TableCell>
                <TableCell><InvoiceStatusBadge status={i.status} labels={t.invoices.statuses} /></TableCell>
                <TableCell className="text-end font-semibold"><Money value={i.total} locale={locale} /></TableCell>
                <TableCell className="text-end"><Money value={toMoney(i.amount_due).minus(toMoney(i.amount_paid))} locale={locale} blankZero /></TableCell>
                <TableCell className={`num ${i.due_date && i.due_date < today && outstanding(i).gt(0) ? "font-semibold text-urgent" : ""}`}>{i.due_date ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
