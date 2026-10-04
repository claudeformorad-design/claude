"use server";
import { tr } from "@/i18n/tr";

import { z } from "zod";
import { getAppContext, type AppContext } from "@/lib/auth/context";
import { PERMISSIONS, type Permission } from "@/lib/auth/permissions";
import { isIsoDate } from "@/lib/accounting/fiscal";
import { formatMoney, toMoney } from "@/lib/accounting/money";
import type { Detail, DetailCell, DetailKind } from "@/lib/details";
import { plainText } from "@/lib/text";
import { getFolio } from "@/services/folio.service";
import { getInvoice } from "@/services/invoices.service";
import { getJournalEntry } from "@/services/journal.service";
import { getBill } from "@/services/payables.service";
import { getReservation } from "@/services/pms.service";
import { getVoucher } from "@/services/vouchers.service";
import { raise, type ActionResult, toActionResult } from "@/services/errors";
import { getDictionary } from "@/i18n/server";

const NEED: Record<DetailKind, Permission> = {
  journal: PERMISSIONS.journalView,
  invoice: PERMISSIONS.invoicesView,
  voucher: PERMISSIONS.paymentsView,
  bill: PERMISSIONS.billsView,
  "purchase-order": PERMISSIONS.purchasesManage,
  folio: PERMISSIONS.folioView,
  reservation: PERMISSIONS.pmsView,
  account: PERMISSIONS.journalView,
  customer: PERMISSIONS.invoicesView,
  vendor: PERMISSIONS.billsView,
};

const input = z.object({
  kind: z.enum(Object.keys(NEED) as [DetailKind, ...DetailKind[]]),
  id: z.uuid(),
  from: z.string().refine(isIsoDate).optional(),
  to: z.string().refine(isIsoDate).optional(),
});

const money = (v: string | number | null | undefined, zeroBlank = false): DetailCell => {
  const m = toMoney(v ?? 0);
  return { text: zeroBlank && m.isZero() ? "" : formatMoney(m), type: "amount", tone: m.isNegative() ? "neg" : undefined };
};
const text = (v: string | null | undefined, tone?: DetailCell["tone"]): DetailCell => ({ text: plainText(v), tone });
const qty = (v: string | number): DetailCell => ({ text: String(Number(v)), type: "amount" });
const date = (v: string | null | undefined): DetailCell => ({ text: v ?? "", type: "date" });
const code = (v: string | null | undefined, href?: string): DetailCell => ({ text: v ?? "", type: "code", href });
const blank = (n: number): DetailCell[] => Array.from({ length: n }, () => text(""));

type Account = { code: string; name: string };
async function accountsOf(ctx: AppContext, ids: string[]) {
  if (!ids.length) return new Map<string, Account>();
  const { data, error } = await ctx.supabase.from("chart_of_accounts").select("id, code, name_ar, name_en").in("id", [...new Set(ids)]);
  raise(error);
  return new Map((data ?? []).map((a) => [a.id as string, { code: a.code as string, name: a.name_ar as string }]));
}
/** خليتا الحساب: رمزه في عمود مستقل، واسمه في عمود بجانبه */
const accountCells = (a: Account | undefined, tone?: DetailCell["tone"]): DetailCell[] => [code(a?.code), text(a?.name, tone)];

/** تفاصيل صف من أي جدول (تُحمَّل عند فتحه فقط)، بنفس صلاحية الصفحة التي يظهر فيها */
export async function loadDetailAction(raw: unknown): Promise<ActionResult<Detail>> {
  const p = input.safeParse(raw);
  if (!p.success) return { ok: false, error: "validation" };
  const ctx = await getAppContext();
  if (!ctx.user || !ctx.hotel) return { ok: false, error: "permission_denied" };
  const app = ctx as AppContext;
  if (!app.can(NEED[p.data.kind])) return { ok: false, error: "permission_denied" };
  return toActionResult(() => build(app, p.data));
}

async function build(ctx: AppContext, { kind, id, from, to }: z.infer<typeof input>): Promise<Detail> {
  const h = ctx.hotel.id;
  const t = getDictionary();
  switch (kind) {
    case "journal": {
      const d = await getJournalEntry(ctx.supabase, h, id);
      if (!d) return { columns: [], rows: [], empty: tr("القيد غير موجود") };
      const accounts = await accountsOf(ctx, d.lines.map((l) => l.account_id));
      const dr = d.lines.reduce((a, l) => a.plus(toMoney(l.base_debit)), toMoney(0));
      const cr = d.lines.reduce((a, l) => a.plus(toMoney(l.base_credit)), toMoney(0));
      return {
        columns: [tr("الرمز"), tr("الحساب"), tr("البيان"), tr("مدين"), tr("دائن")],
        rows: d.lines.map((l) => [...accountCells(accounts.get(l.account_id)), text(l.description, "muted"), money(l.base_debit, true), money(l.base_credit, true)]),
        totals: [text(tr("الإجمالي")), ...blank(2), money(dr.toFixed()), money(cr.toFixed())],
        link: { href: `/journal/${id}`, label: tr("فتح القيد") },
      };
    }
    case "invoice": {
      const d = await getInvoice(ctx.supabase, h, id);
      if (!d) return { columns: [], rows: [], empty: tr("الفاتورة غير موجودة") };
      return {
        facts: [
          { label: tr("الصافي"), value: formatMoney(d.invoice.subtotal), amount: true },
          { label: tr("الضريبة"), value: formatMoney(d.invoice.tax_total), amount: true },
          { label: tr("المدفوع"), value: formatMoney(d.invoice.amount_paid), amount: true },
          { label: tr("المتبقي"), value: formatMoney(d.invoice.amount_due), amount: true },
        ],
        columns: [tr("البيان"), tr("الكمية"), tr("سعر الوحدة"), tr("الضريبة"), tr("الإجمالي")],
        rows: d.items.map((i) => [text(i.description), qty(i.quantity), money(i.unit_price), money(i.tax_amount, true), money(i.total_amount)]),
        totals: [text(tr("الإجمالي")), ...blank(2), money(d.invoice.tax_total), money(d.invoice.total)],
        link: { href: `/invoices/${id}`, label: tr("فتح الفاتورة") },
      };
    }
    case "voucher": {
      const d = await getVoucher(ctx.supabase, h, id);
      if (!d) return { columns: [], rows: [], empty: tr("السند غير موجود") };
      return {
        facts: [{ label: tr("البيان"), value: plainText(d.voucher.description) }, ...(d.voucher.reference ? [{ label: tr("المرجع"), value: d.voucher.reference }] : [])],
        columns: [tr("مخصص للفاتورة"), tr("المبلغ")],
        rows: d.allocations.map((a) => [code(a.invoice_number, `/invoices/${a.invoice_id}`), money(a.amount)]),
        empty: tr("لم يُخصص السند لفواتير"),
        link: { href: `/vouchers/${id}`, label: tr("فتح السند") },
      };
    }
    case "bill": {
      const d = await getBill(ctx.supabase, h, id);
      if (!d) return { columns: [], rows: [], empty: tr("الفاتورة غير موجودة") };
      const accounts = await accountsOf(ctx, d.lines.map((l) => l.account_id));
      return {
        columns: [tr("البيان"), tr("الرمز"), tr("الحساب"), tr("الكمية"), tr("سعر الوحدة"), tr("الضريبة"), tr("الصافي")],
        rows: d.lines.map((l) => [text(l.description), ...accountCells(accounts.get(l.account_id), "muted"), qty(l.quantity), money(l.unit_price), money(l.tax_amount, true), money(l.net_amount)]),
        link: { href: `/bills/${id}`, label: tr("فتح فاتورة المورد") },
      };
    }
    case "purchase-order": {
      const { data, error } = await ctx.supabase.from("purchase_order_items")
        .select("line_no, description, account_id, quantity::text, unit_price::text").eq("po_id", id).eq("hotel_id", h).order("line_no");
      raise(error);
      const lines = data ?? [];
      const accounts = await accountsOf(ctx, lines.map((l) => l.account_id));
      const sum = lines.reduce((a, l) => a.plus(toMoney(l.quantity).times(toMoney(l.unit_price))), toMoney(0));
      return {
        columns: [tr("البيان"), tr("الرمز"), tr("الحساب"), tr("الكمية"), tr("سعر الوحدة"), tr("المبلغ")],
        rows: lines.map((l) => [text(l.description), ...accountCells(accounts.get(l.account_id), "muted"), qty(l.quantity), money(l.unit_price), money(toMoney(l.quantity).times(toMoney(l.unit_price)).toFixed())]),
        totals: [text(tr("الإجمالي")), ...blank(4), money(sum.toFixed())],
      };
    }
    case "folio": {
      const d = await getFolio(ctx.supabase, h, id);
      if (!d) return { columns: [], rows: [], empty: tr("الفوليو غير موجود") };
      return {
        facts: [{ label: tr("الرصيد"), value: formatMoney(d.balance), amount: true }, { label: tr("العربون المتاح"), value: formatMoney(d.deposits), amount: true }],
        columns: [tr("التاريخ"), tr("النوع"), tr("البيان"), tr("المبلغ")],
        rows: d.transactions.map((x) => [
          date(x.business_date), text(t.folio.txnTypes[x.txn_type] ?? x.txn_type, "muted"), text(x.description),
          money(toMoney(x.total_amount).times(x.direction).toFixed()),
        ]),
        empty: tr("لا حركات بعد"),
        link: { href: `/folios/${id}`, label: tr("فتح الفوليو") },
      };
    }
    case "reservation": {
      const d = await getReservation(ctx.supabase, h, id);
      if (!d) return { columns: [], rows: [], empty: tr("الحجز غير موجود") };
      const total = d.nights.reduce((a, n) => a.plus(toMoney(n.amount)), toMoney(0));
      return {
        facts: [
          ...(d.customer ? [{ label: tr("الشركة"), value: d.customer.name_ar }] : []),
          ...(d.group ? [{ label: tr("المجموعة"), value: d.group.name }] : []),
          ...(d.notes ? [{ label: tr("ملاحظات"), value: plainText(d.notes) }] : []),
        ],
        columns: [tr("الليلة"), tr("الموسم"), tr("السعر"), tr("الخصم"), tr("المبلغ")],
        rows: d.nights.map((n) => [date(n.stay_date), text(n.season_name ?? "", "muted"), money(n.rate), money(n.discount, true), money(n.amount)]),
        totals: [text(tr("الإجمالي")), ...blank(3), money(total.toFixed())],
        link: { href: `/reservations/${id}`, label: tr("فتح الحجز") },
      };
    }
    case "customer": {
      const { data, error } = await ctx.supabase.from("invoices")
        .select("id, invoice_number, issue_date, due_date, total::text, amount_due::text, status")
        .eq("hotel_id", h).eq("customer_id", id).order("issue_date", { ascending: false }).limit(50);
      raise(error);
      const due = (data ?? []).reduce((a, i) => a.plus(toMoney(i.amount_due)), toMoney(0));
      return {
        facts: [{ label: tr("المستحق عليه"), value: formatMoney(due.toFixed()), amount: true }],
        columns: [tr("الفاتورة"), tr("التاريخ"), tr("الاستحقاق"), tr("الإجمالي"), tr("المتبقي")],
        rows: (data ?? []).map((i) => [
          code(i.invoice_number, `/invoices/${i.id}`), date(i.issue_date), date(i.due_date), money(i.total), money(i.amount_due, true),
        ]),
        empty: tr("لا فواتير لهذا العميل"),
        link: { href: `/invoices?customer=${id}`, label: tr("كل فواتير العميل") },
      };
    }
    case "vendor": {
      const { data, error } = await ctx.supabase.from("vendor_bills")
        .select("id, bill_number, bill_date, due_date, total::text, amount_paid::text, status")
        .eq("hotel_id", h).eq("vendor_id", id).order("bill_date", { ascending: false }).limit(50);
      raise(error);
      const rest = (b: { total: string; amount_paid: string }) => toMoney(b.total).minus(toMoney(b.amount_paid));
      const due = (data ?? []).reduce((a, b) => a.plus(rest(b)), toMoney(0));
      return {
        facts: [{ label: tr("المستحق له"), value: formatMoney(due.toFixed()), amount: true }],
        columns: [tr("الفاتورة"), tr("التاريخ"), tr("الاستحقاق"), tr("الإجمالي"), tr("المتبقي")],
        rows: (data ?? []).map((b) => [
          code(b.bill_number, `/bills/${b.id}`), date(b.bill_date), date(b.due_date), money(b.total), money(rest(b).toFixed(), true),
        ]),
        empty: tr("لا فواتير لهذا المورد"),
        link: { href: `/bills?vendor=${id}`, label: tr("كل فواتير المورد") },
      };
    }
    case "account": {
      let q = ctx.supabase.from("journal_entry_lines")
        .select("base_debit::text, base_credit::text, description, journal_entries!inner(id, entry_date, entry_number, description, status)")
        .eq("hotel_id", h).eq("account_id", id).eq("journal_entries.status", "posted");
      if (from) q = q.gte("journal_entries.entry_date", from);
      if (to) q = q.lte("journal_entries.entry_date", to);
      const { data, error } = await q.limit(500);
      raise(error);
      const lines = ((data ?? []) as unknown as {
        base_debit: string; base_credit: string; description: string | null;
        journal_entries: { id: string; entry_date: string; entry_number: string | null; description: string };
      }[]).sort((a, b) => a.journal_entries.entry_date.localeCompare(b.journal_entries.entry_date));
      const dr = lines.reduce((a, l) => a.plus(toMoney(l.base_debit)), toMoney(0));
      const cr = lines.reduce((a, l) => a.plus(toMoney(l.base_credit)), toMoney(0));
      return {
        columns: [tr("التاريخ"), tr("القيد"), tr("البيان"), tr("مدين"), tr("دائن")],
        rows: lines.map((l) => [
          date(l.journal_entries.entry_date), code(l.journal_entries.entry_number, `/journal/${l.journal_entries.id}`),
          text(l.description || l.journal_entries.description), money(l.base_debit, true), money(l.base_credit, true),
        ]),
        totals: lines.length > 1 ? [text(tr("الإجمالي")), ...blank(2), money(dr.toFixed()), money(cr.toFixed())] : undefined,
        empty: tr("لا حركات على الحساب في الفترة"),
      };
    }
  }
}
