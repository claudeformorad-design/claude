import { tr } from "@/i18n/tr";
import { ExpandableRow, ExpandMark } from "@/components/ui/expandable-row";
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
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { verifyChain } from "@/services/zatca.service";
import { EntityCell } from "@/components/ui/entity";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { Pager, pageSlice } from "@/components/ui/pager";

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; customer?: string; page?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.invoicesView);
  const { locale, t } = await getI18n();
  const sp = await searchParams;
  const [invoices, chain] = await Promise.all([
    listInvoices(ctx.supabase, ctx.hotel.id, { status: sp.status, q: sp.q, customerId: sp.customer }),
    verifyChain(ctx.supabase, ctx.hotel.id),
  ]);

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

  const shown = pageSlice(invoices, sp.page);

  return (
    <>
      <PageHeader
        title={t.invoices.title}
        actions={ctx.can(PERMISSIONS.invoicesCreate) && (
          <Button asChild><Link href="/invoices/new"><Plus />{t.invoices.newDirect}</Link></Button>
        )}
      />
      <StatGrid>
        <Stat icon={FileText} tone="ink" label={tr("فواتير في القائمة")} value={<span className="num">{invoices.length}</span>} />
        <Stat currency={ctx.hotel.base_currency} icon={Receipt} tone="teal" label={tr("إجمالي المفوتر")} value={<Money value={totalInvoiced} locale={locale} />} />
        <Stat currency={ctx.hotel.base_currency} icon={Hourglass} tone="clay" label={tr("المتبقي للتحصيل")} value={<Money value={totalOutstanding} locale={locale} />} />
        <Stat icon={AlarmClock} tone="neutral" label={tr("متأخرة السداد")} value={<span className="num">{overdue.length}</span>}
          hint={overdue.length ? <>{tr("بقيمة")}{" "}<Money value={overdue.reduce((a, i) => a.plus(outstanding(i)), ZERO)} locale={locale} /></> : tr("لا يوجد تأخير")} />
      </StatGrid>
      <p className={chain.ok ? "flex items-center gap-2 text-[14.5px] text-success" : "flex items-center gap-2 text-[14.5px] text-urgent"}>
        {chain.ok ? <ShieldCheck className="size-4" /> : <ShieldAlert className="size-4" />}
        {chain.ok ? tr("سلسلة الفوترة الإلكترونية سليمة: كل الفواتير مختومة بتسلسل متصل ولم يُعدَّل أي منها.")
          : tr("سلسلة الفوترة الإلكترونية منكسرة عند المستند {0} ({1}). راجع سجل التدقيق.", chain.problems[0]!.doc_number, chain.problems[0]!.problem)}
      </p>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <FilterTabs active={sp.status ?? "all"} items={[
          { key: "all", href: qs(), label: tr("الكل") },
          ...(["issued", "partially_paid", "paid"] as const).map((k) => ({ key: k, href: qs(k), label: t.invoices.statuses[k] })),
        ]} />
        <form className="flex items-center gap-2">
          {sp.status && <input type="hidden" name="status" value={sp.status} />}
          <Input name="q" defaultValue={sp.q} placeholder={tr("ابحث برقم الفاتورة أو الاسم")} className="w-64 bg-white" />
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
                    title={tr("لا توجد فواتير ضريبية صادرة")}
                    description={tr("لم يتم إصدار أي فاتورة ضريبية بعد. يمكنك إصدار فاتورة مباشرة للنزلاء أو الشركات.")}
                    actionHref="/invoices/new"
                    actionLabel={tr("إصدار فاتورة جديدة")}
                    icon={FileText}
                  />
                </TableCell>
              </TableRow>
            )}
            {shown.rows.map((i) => (
              <ExpandableRow kind="invoice" id={i.id} colSpan={7} key={i.id}>
                <TableCell><ExpandMark />
                  <Link href={`/invoices/${i.id}`} className="num block font-semibold text-ink">{i.invoice_number}</Link>
                  <span className="text-[15.5px] text-slate-500">{t.invoices.types[i.invoice_type]}</span>
                </TableCell>
                <TableCell className="num">{i.issue_date}</TableCell>
                <TableCell className="cell-fluid"><EntityCell name={i.bill_to_name} /></TableCell>
                <TableCell><InvoiceStatusBadge status={i.status} labels={t.invoices.statuses} /></TableCell>
                <TableCell className="text-end font-semibold"><Money value={i.total} locale={locale} /></TableCell>
                <TableCell className="text-end"><Money value={toMoney(i.amount_due).minus(toMoney(i.amount_paid))} locale={locale} blankZero /></TableCell>
                <TableCell className={`num ${i.due_date && i.due_date < today && outstanding(i).gt(0) ? "font-semibold text-urgent" : ""}`}>{i.due_date ?? ""}</TableCell>
              </ExpandableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <Pager page={shown.page} pages={shown.pages} total={invoices.length} basePath="/invoices" params={{ status: sp.status, q: sp.q, customer: sp.customer }} />
    </>
  );
}
