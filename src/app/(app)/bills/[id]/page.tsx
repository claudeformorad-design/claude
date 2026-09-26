import Link from "@/components/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toMoney } from "@/lib/accounting/money";
import { getBill } from "@/services/payables.service";
import { listPaymentMethods } from "@/services/revenue-settings.service";
import { listAccounts } from "@/services/accounts.service";
import { getI18n } from "@/i18n/server";
import { PayBillForm } from "./pay-form";

export default async function BillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireAppContext(PERMISSIONS.billsView);
  const { locale, t } = await getI18n();
  const d = await getBill(ctx.supabase, ctx.hotel.id, id);
  if (!d) notFound();
  const { bill, lines } = d;
  const [vendor, accounts, methods] = await Promise.all([
    ctx.supabase.from("vendors").select("name_ar, name_en").eq("id", bill.vendor_id).single(),
    listAccounts(ctx.supabase, ctx.hotel.id),
    listPaymentMethods(ctx.supabase, ctx.hotel.id),
  ]);
  const acc = new Map(accounts.map((a) => [a.id, `${a.code} — ${(locale === "en" && a.name_en) || a.name_ar}`]));
  const outstanding = toMoney(bill.total).minus(toMoney(bill.amount_paid));
  return (
    <>
      <PageHeader title={`${t.payables.billNumber} ${bill.bill_number}`}
        description={`${(locale === "en" && vendor.data?.name_en) || vendor.data?.name_ar} · ${bill.vendor_invoice_no ?? ""}`}
        actions={<Badge>{t.payables.statuses[bill.status]}</Badge>} />
      <Card className="mb-6 overflow-hidden">
        <Table>
          <TableHeader><TableRow>
            <TableHead>#</TableHead><TableHead>{t.common.description}</TableHead><TableHead>{t.payables.account}</TableHead>
            <TableHead className="text-end">{t.folio.quantity}</TableHead><TableHead className="text-end">{t.folio.net}</TableHead><TableHead className="text-end">{t.folio.tax}</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {lines.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="num">{l.line_no}</TableCell><TableCell>{l.description}</TableCell><TableCell>{acc.get(l.account_id)}</TableCell>
                <TableCell className="num text-end">{toMoney(l.quantity).toString()}</TableCell>
                <TableCell className="text-end"><Money value={l.net_amount} locale={locale} /></TableCell>
                <TableCell className="text-end"><Money value={l.tax_amount} locale={locale} blankZero /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <CardContent className="grid gap-1 border-t pt-4 text-sm sm:w-80">
          <div className="flex justify-between"><span>{t.invoices.subtotal}</span><Money value={bill.subtotal} locale={locale} /></div>
          <div className="flex justify-between"><span>{t.invoices.taxTotal}</span><Money value={bill.tax_total} locale={locale} /></div>
          <div className="flex justify-between font-bold"><span>{t.invoices.total}</span><Money value={bill.total} locale={locale} /></div>
          <div className="flex justify-between"><span>{t.invoices.outstanding}</span><Money value={outstanding} locale={locale} /></div>
          {bill.journal_entry_id && <Link className="text-primary hover:underline" href={`/journal/${bill.journal_entry_id}`}>{t.journal.entry}</Link>}
        </CardContent>
      </Card>
      {outstanding.gt(0) && ctx.can(PERMISSIONS.paymentsDisbursement) && (
        <PayBillForm t={{ payables: t.payables, folio: t.folio, errors: t.errors }} billId={bill.id} vendorId={bill.vendor_id}
          outstanding={outstanding.toFixed()} methods={methods.filter((m) => m.is_active && m.kind !== "city_ledger").map((m) => ({ id: m.id, label: (locale === "en" && m.name_en) || m.name_ar }))} />
      )}
    </>
  );
}
