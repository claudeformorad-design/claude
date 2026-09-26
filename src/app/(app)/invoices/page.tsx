import Link from "@/components/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toMoney } from "@/lib/accounting/money";
import { listInvoices } from "@/services/invoices.service";
import { getI18n } from "@/i18n/server";
import { InvoiceStatusBadge } from "./status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { FileText } from "lucide-react";

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; customer?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.invoicesView);
  const { locale, t } = await getI18n();
  const sp = await searchParams;
  const invoices = await listInvoices(ctx.supabase, ctx.hotel.id, { status: sp.status, q: sp.q, customerId: sp.customer });

  return (
    <>
      <PageHeader
        title={t.invoices.title}
        description={t.invoices.subtitle}
        actions={ctx.can(PERMISSIONS.invoicesCreate) && (
          <Button asChild><Link href="/invoices/new"><Plus />{t.invoices.newDirect}</Link></Button>
        )}
      />
      <form className="mb-4 flex flex-wrap gap-2">
        <Input name="q" defaultValue={sp.q} placeholder={t.common.search} className="w-56" />
        <NativeSelect name="status" defaultValue={sp.status ?? ""} className="w-40">
          <option value="">{t.common.status}</option>
          {(["issued", "partially_paid", "paid"] as const).map((s) => <option key={s} value={s}>{t.invoices.statuses[s]}</option>)}
        </NativeSelect>
        <Button type="submit" variant="outline">{t.common.apply}</Button>
      </form>
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
                  <Link href={`/invoices/${i.id}`} className="num font-medium text-primary hover:underline">{i.invoice_number}</Link>{" "}
                  <Badge variant="outline">{t.invoices.types[i.invoice_type]}</Badge>
                </TableCell>
                <TableCell className="num">{i.issue_date}</TableCell>
                <TableCell>{i.bill_to_name}</TableCell>
                <TableCell><InvoiceStatusBadge status={i.status} labels={t.invoices.statuses} /></TableCell>
                <TableCell className="text-end"><Money value={i.total} locale={locale} /></TableCell>
                <TableCell className="text-end"><Money value={toMoney(i.amount_due).minus(toMoney(i.amount_paid))} locale={locale} blankZero /></TableCell>
                <TableCell className="num">{i.due_date ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
