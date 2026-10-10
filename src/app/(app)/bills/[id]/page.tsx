import { tr } from "@/i18n/tr";
import { AmountReasonForm } from "../../_ledger/forms";
import { AttachmentsCard } from "../../_ledger/attachments-card";
import { debitNoteAction } from "../../_ledger/actions";
import Link from "@/components/link";
import { CodeName, DocText } from "@/components/ui/code-text";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Properties } from "@/components/ui/properties";
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
  const [vendor, accounts, methods, returns] = await Promise.all([
    ctx.supabase.from("vendors").select("name_ar, name_en").eq("id", bill.vendor_id).single(),
    listAccounts(ctx.supabase, ctx.hotel.id),
    listPaymentMethods(ctx.supabase, ctx.hotel.id),
    ctx.supabase.from("vendor_debit_notes").select("id, debit_note_number, issue_date, total::text, reason, journal_entry_id").eq("bill_id", id).order("issue_date"),
  ]);
  const returned = (returns.data ?? []).reduce((a, r) => a.plus(toMoney(r.total)), toMoney("0"));
  const acc = new Map(accounts.map((a) => [a.id, `${a.code} ${(locale === "en" && a.name_en) || a.name_ar}`]));
  const outstanding = toMoney(bill.total).minus(toMoney(bill.amount_paid));
  return (
    <>
      <PageHeader title={`${t.payables.billNumber} ${bill.bill_number}`}
        actions={<Badge>{t.payables.statuses[bill.status]}</Badge>} />
      <Properties items={[
        [t.payables.vendor, (locale === "en" && vendor.data?.name_en) || vendor.data?.name_ar],
        [t.payables.vendorInvoiceNo, bill.vendor_invoice_no && <span className="num">{bill.vendor_invoice_no}</span>],
        [t.common.date, <span key="d" className="num">{bill.bill_date}</span>],
        [tr("الاستحقاق"), bill.due_date && <span className="num">{bill.due_date}</span>],
      ]} />
      <Card className="mb-6 overflow-hidden">
        <Table>
          <TableHeader><TableRow>
            <TableHead>#</TableHead><TableHead>{t.common.description}</TableHead><TableHead>{t.payables.account}</TableHead>
            <TableHead className="text-end">{t.folio.quantity}</TableHead><TableHead className="text-end">{t.folio.net}</TableHead><TableHead className="text-end">{t.folio.tax}</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {lines.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="num">{l.line_no}</TableCell><TableCell><DocText text={l.description} /></TableCell><TableCell><CodeName label={acc.get(l.account_id) ?? ""} /></TableCell>
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
          {returned.gt(0) && <div className="flex justify-between"><span>{tr("المرتجعات")}</span><Money value={returned} locale={locale} /></div>}
          <div className="flex justify-between"><span>{t.invoices.outstanding}</span><Money value={outstanding} locale={locale} /></div>
          {bill.journal_entry_id && <Link className="text-primary" href={`/journal/${bill.journal_entry_id}`}>{t.journal.entry}</Link>}
        </CardContent>
      </Card>
      {(returns.data ?? []).length > 0 && (
        <Card className="space-y-1 p-4 text-[15px]">
          <p className="font-semibold">{tr("مرتجعات المشتريات")}</p>
          {(returns.data ?? []).map((r) => (
            <p key={r.id}><span className="num">{r.debit_note_number}</span>{" "}{tr("بتاريخ")}{" "}<span className="num">{r.issue_date}</span>{" "}{tr("بمبلغ")}{" "}<Money value={r.total} locale={locale} />{tr("،")}{" "}{r.reason}
              {r.journal_entry_id && <>{" "}<Link className="text-action" href={`/journal/${r.journal_entry_id}`}>{t.journal.entry}</Link></>}</p>
          ))}
        </Card>
      )}
      {outstanding.gt(0) && ctx.can(PERMISSIONS.billsDebitNote) && (
        <AmountReasonForm title={tr("مرتجع مشتريات")} button={tr("إصدار إشعار مدين")} done={tr("صدر إشعار المرتجع")} errors={t.errors}
          hint={tr("يخفّض المستحق للمورد ويعكس المصروف وضريبة المدخلات بنسبة بنود الفاتورة. المبلغ شامل الضريبة.")}
          run={debitNoteAction.bind(null, bill.id)} />
      )}
      {outstanding.gt(0) && ctx.can(PERMISSIONS.paymentsDisbursement) && (
        <PayBillForm t={{ payables: t.payables, folio: t.folio, errors: t.errors }} billId={bill.id} vendorId={bill.vendor_id}
          outstanding={outstanding.toFixed()} methods={methods.filter((m) => m.is_active && m.kind !== "city_ledger" && !m.currency_code).map((m) => ({ id: m.id, label: (locale === "en" && m.name_en) || m.name_ar }))} />
      )}
      <AttachmentsCard ctx={ctx} entity="vendor_bill" entityId={bill.id} path={`/bills/${bill.id}`} errors={t.errors} />
    </>
  );
}
