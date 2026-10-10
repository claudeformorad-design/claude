import { tr } from "@/i18n/tr";
import { DocText } from "@/components/ui/code-text";
import { currencyName } from "@/lib/currency-name";
import Link from "@/components/link";
import { notFound } from "next/navigation";
import { Money } from "@/components/money";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toMoney } from "@/lib/accounting/money";
import { getInvoice } from "@/services/invoices.service";
import { listTaxRates } from "@/services/revenue-settings.service";
import { getI18n } from "@/i18n/server";
import { InvoiceStatusBadge } from "../status-badge";
import { PrintButton } from "./print-button";
import { CreditNoteForm } from "./credit-note";
import { qrSvg, qrText, zatcaRecords } from "@/services/zatca.service";
import { AmountReasonForm } from "../../_ledger/forms";
import { AttachmentsCard } from "../../_ledger/attachments-card";
import { writeOffAction } from "../../_ledger/actions";

/** فاتورة ضريبية قابلة للطباعة (تصدير PDF الرسمي في المرحلة 5) */
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireAppContext(PERMISSIONS.invoicesView);
  const { locale, t } = await getI18n();
  const [detail, taxes, creditNotes, folio, writeOffs] = await Promise.all([
    getInvoice(ctx.supabase, ctx.hotel.id, id),
    listTaxRates(ctx.supabase, ctx.hotel.id),
    ctx.supabase.from("credit_notes").select("id, credit_note_number, issue_date, total::text, reason").eq("invoice_id", id),
    ctx.supabase.from("invoices").select("folio_id").eq("id", id).maybeSingle()
      .then(async ({ data }) => data?.folio_id ? (await ctx.supabase.from("guest_folios").select("folio_number, room_number").eq("id", data.folio_id).maybeSingle()).data : null),
    ctx.supabase.from("invoice_write_offs").select("id, write_off_date, amount::text, reason, journal_entry_id").eq("invoice_id", id).order("write_off_date"),
  ]);
  if (!detail) notFound();
  const { invoice: inv, items } = detail;
  const sealed = await zatcaRecords(ctx.supabase, ctx.hotel.id, [inv.id, ...(creditNotes.data ?? []).map((c) => c.id)]);
  const z = sealed.get(inv.id);
  const qr = z ? await qrSvg(qrText(ctx.hotel, z)) : null;
  const taxById = new Map(taxes.map((x) => [x.id, x]));
  const hotel = ctx.hotel;
  const m = (v: string) => <Money value={v} locale={locale} />;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <InvoiceStatusBadge status={inv.status} labels={t.invoices.statuses} />
        <PrintButton label={t.invoices.print} />
      </div>
      <Card className="overflow-hidden print:border-0 print:shadow-none">
        <div className="h-1.5 bg-ink print:hidden" />
        <CardContent className="space-y-6 p-8">
          <div className="flex flex-wrap items-start justify-between gap-6 border-b pb-6">
            <div>
              <p className="text-xl font-bold">{(locale === "en" && hotel.name_en) || hotel.name_ar}</p>
              {hotel.legal_name && <p className="text-sm">{hotel.legal_name}</p>}
              {hotel.tax_number && <p className="text-sm text-muted-foreground">{t.invoices.taxNumber}: <span className="num">{hotel.tax_number}</span></p>}
              {hotel.address && <p className="text-sm text-muted-foreground">{hotel.address}</p>}
            </div>
            <div className="text-end">
              <p className="text-2xl font-bold text-ink">{z?.invoice_type === "simplified" ? tr("فاتورة ضريبية مبسطة") : t.invoices.taxInvoice}</p>
              <p className="num text-lg font-semibold text-accent1">{inv.invoice_number}</p>
              <p className="text-sm text-muted-foreground">{t.invoices.issueDate}: <span className="num">{inv.issue_date}</span></p>
              {inv.due_date && <p className="text-sm text-muted-foreground">{t.invoices.dueDate}: <span className="num">{inv.due_date}</span></p>}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-sm text-muted-foreground">{t.invoices.billTo}</p>
              <p className="font-semibold">{inv.bill_to_name}</p>
              {inv.bill_to_tax_number && <p className="text-sm">{t.invoices.taxNumber}: <span className="num">{inv.bill_to_tax_number}</span></p>}
              {inv.bill_to_address && <p className="text-sm">{inv.bill_to_address}</p>}
            </div>
            {inv.folio_id && (
              <div className="sm:text-end">
                <p className="text-sm text-muted-foreground">{t.nav.folios}</p>
                <Link href={`/folios/${inv.folio_id}`} className="num text-primary">{folio?.folio_number ?? t.folio.folioNumber}</Link>
                {folio?.room_number && <p className="text-sm">{t.folio.room} <span className="num">{folio.room_number}</span></p>}
              </div>
            )}
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>{t.common.date}</TableHead>
                <TableHead>{t.common.description}</TableHead>
                <TableHead className="text-end">{t.folio.quantity}</TableHead>
                <TableHead className="text-end">{t.folio.net}</TableHead>
                <TableHead className="text-end">{t.folio.tax}</TableHead>
                <TableHead className="text-end">{t.folio.total}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell className="num">{it.line_no}</TableCell>
                  <TableCell className="num">{it.business_date ?? ""}</TableCell>
                  <TableCell><DocText text={it.description} /></TableCell>
                  <TableCell className="num text-end">{toMoney(it.quantity).toString()}</TableCell>
                  <TableCell className="text-end">{m(it.net_amount)}</TableCell>
                  <TableCell className="text-end">{m(it.tax_amount)}</TableCell>
                  <TableCell className="text-end">{m(it.total_amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-sm font-semibold">{t.invoices.taxSummary}</p>
              <table className="w-full text-sm">
                <tbody>
                  {detail.taxes.map((x) => {
                    const rate = taxById.get(x.tax_rate_id);
                    return (
                      <tr key={x.tax_rate_id} className="border-b">
                        <td className="py-1">{rate ? `${(locale === "en" && rate.name_en) || rate.name_ar} ${toMoney(rate.rate).toString()}%` : ""}</td>
                        <td className="py-1 text-end text-muted-foreground">{t.invoices.taxableBase}: {m(x.taxable_base)}</td>
                        <td className="py-1 text-end">{m(x.amount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <table className="w-full text-sm">
              <tbody>
                <tr><td className="py-1">{t.invoices.subtotal}</td><td className="py-1 text-end">{m(inv.subtotal)}</td></tr>
                <tr><td className="py-1">{t.invoices.taxTotal}</td><td className="py-1 text-end">{m(inv.tax_total)}</td></tr>
                <tr className="text-base font-bold"><td className="rounded-s-lg bg-accent1-tint px-3 py-2.5 text-accent1 print:bg-transparent print:text-ink">{t.invoices.total} {currencyName(inv.currency_code)}</td><td className="rounded-e-lg bg-accent1-tint px-3 py-2.5 text-end text-accent1 print:bg-transparent print:text-ink">{m(inv.total)}</td></tr>
                {toMoney(inv.amount_due).gt(0) && (
                  <>
                    <tr><td className="py-1">{t.invoices.amountDue}</td><td className="py-1 text-end">{m(inv.amount_due)}</td></tr>
                    <tr><td className="py-1">{t.invoices.amountPaid}</td><td className="py-1 text-end">{m(inv.amount_paid)}</td></tr>
                    <tr className="font-semibold"><td className="py-1">{t.invoices.outstanding}</td><td className="py-1 text-end"><Money value={toMoney(inv.amount_due).minus(toMoney(inv.amount_paid))} locale={locale} /></td></tr>
                  </>
                )}
              </tbody>
            </table>
          </div>

          {detail.allocations.length > 0 && (
            <div className="print:hidden">
              <p className="mb-2 text-sm font-semibold">{t.invoices.settlement}</p>
              <ul className="space-y-1 text-sm">
                {detail.allocations.map((a) => (
                  <li key={a.payment_id} className={a.voucher_status === "voided" ? "text-muted-foreground line-through" : ""}>
                    <Link href={`/vouchers/${a.payment_id}`} className="num text-primary">{a.voucher_number}</Link>{" "}{tr("بمبلغ")}{" "}{m(a.amount)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(creditNotes.data ?? []).length > 0 && (
            <div>
              <p className="mb-2 text-sm font-semibold">{t.payables.creditNote}</p>
              <ul className="space-y-1 text-sm">
                {(creditNotes.data ?? []).map((c) => (
                  <li key={c.id}><span className="num">{c.credit_note_number}</span>{" "}{tr("بتاريخ")}{" "}<span className="num">{c.issue_date}</span>{" "}{tr("بمبلغ")}{" "}{m(c.total)}{tr("،")}{" "}{c.reason}
                    {sealed.has(c.id) && <>{" "}<a href={`/api/zatca/${c.id}`} className="text-action print:hidden">{tr("ملف XML")}</a></>}</li>
                ))}
              </ul>
            </div>
          )}
          {(writeOffs.data ?? []).length > 0 && (
            <div>
              <p className="mb-2 text-sm font-semibold">{tr("ديون معدومة")}</p>
              <ul className="space-y-1 text-sm">
                {(writeOffs.data ?? []).map((w) => (
                  <li key={w.id}>{tr("بتاريخ")}{" "}<span className="num">{w.write_off_date}</span>{" "}{tr("بمبلغ")}{" "}{m(w.amount)}{tr("،")}{" "}{w.reason}
                    {w.journal_entry_id && <>{" "}<Link href={`/journal/${w.journal_entry_id}`} className="text-action print:hidden">{t.journal.entry}</Link></>}</li>
                ))}
              </ul>
            </div>
          )}
          {inv.notes && <p className="text-sm text-muted-foreground">{inv.notes}</p>}
          {z && (
            <div className="flex flex-wrap items-center gap-5 border-t pt-5">
              {qr && <div className="size-28 shrink-0 [&>svg]:size-full" role="img" aria-label={tr("رمز الفاتورة الإلكترونية")} dangerouslySetInnerHTML={{ __html: qr }} />}
              <div className="min-w-0 space-y-1 text-[13px] text-slate-500">
                <p className="font-medium text-ink">{tr("فاتورة إلكترونية")}</p>
                <p>{tr("الرقم التسلسلي")}: <span className="num">{z.icv}</span></p>
                <p className="break-all">{tr("المعرّف")}: <span className="num">{z.uuid}</span></p>
                {!z.seller_vat && <p className="text-urgent print:hidden">{tr("أضف الرقم الضريبي للمنشأة في إعدادات الفندق حتى يظهر في رمز الفاتورة.")}</p>}
                <a href={`/api/zatca/${inv.id}`} className="inline-block text-action print:hidden">{tr("تنزيل ملف XML")}</a>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      {ctx.can(PERMISSIONS.creditNote) && toMoney(inv.amount_due).gt(toMoney(inv.amount_paid)) && (
        <CreditNoteForm invoiceId={inv.id} t={{ payables: t.payables, folio: t.folio, errors: t.errors }} />
      )}
      {ctx.can(PERMISSIONS.invoicesWriteOff) && inv.customer_id && toMoney(inv.amount_due).gt(toMoney(inv.amount_paid)) && (
        <AmountReasonForm title={tr("إعدام دين معدوم")} button={tr("إعدام المبلغ")} done={tr("سُجّل الدين المعدوم")} errors={t.errors}
          hint={tr("حين يتعذر تحصيل المبلغ نهائيًا: يُقيَّد مصروفًا في الديون المعدومة ويقل المستحق على العميل.")}
          run={writeOffAction.bind(null, inv.id)} />
      )}
      <AttachmentsCard ctx={ctx} entity="invoice" entityId={inv.id} path={`/invoices/${inv.id}`} errors={t.errors} />
    </div>
  );
}
