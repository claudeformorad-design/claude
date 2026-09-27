"use server";

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
  return { text: zeroBlank && m.isZero() ? "" : formatMoney(m), num: true, tone: m.isNegative() ? "neg" : undefined };
};
const text = (v: string | null | undefined, tone?: DetailCell["tone"]): DetailCell => ({ text: plainText(v), tone });
const num = (v: string | number): DetailCell => ({ text: String(Number(v)), num: true });

async function accountNames(ctx: AppContext, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const { data, error } = await ctx.supabase.from("chart_of_accounts").select("id, code, name_ar").in("id", [...new Set(ids)]);
  raise(error);
  return new Map((data ?? []).map((a) => [a.id as string, `${a.code} ${a.name_ar}`]));
}

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
      if (!d) return { columns: [], rows: [], empty: "القيد غير موجود" };
      const names = await accountNames(ctx, d.lines.map((l) => l.account_id));
      const dr = d.lines.reduce((a, l) => a.plus(toMoney(l.base_debit)), toMoney(0));
      const cr = d.lines.reduce((a, l) => a.plus(toMoney(l.base_credit)), toMoney(0));
      return {
        columns: ["الحساب", "البيان", "مدين", "دائن"],
        rows: d.lines.map((l) => [text(names.get(l.account_id)), text(l.description, "muted"), money(l.base_debit, true), money(l.base_credit, true)]),
        totals: [text("الإجمالي"), text(""), money(dr.toFixed()), money(cr.toFixed())],
        link: { href: `/journal/${id}`, label: "فتح القيد" },
      };
    }
    case "invoice": {
      const d = await getInvoice(ctx.supabase, h, id);
      if (!d) return { columns: [], rows: [], empty: "الفاتورة غير موجودة" };
      return {
        facts: [
          { label: "الصافي", value: formatMoney(d.invoice.subtotal), num: true },
          { label: "الضريبة", value: formatMoney(d.invoice.tax_total), num: true },
          { label: "المدفوع", value: formatMoney(d.invoice.amount_paid), num: true },
          { label: "المتبقي", value: formatMoney(d.invoice.amount_due), num: true },
        ],
        columns: ["البيان", "الكمية", "سعر الوحدة", "الضريبة", "الإجمالي"],
        rows: d.items.map((i) => [text(i.description), num(i.quantity), money(i.unit_price), money(i.tax_amount, true), money(i.total_amount)]),
        totals: [text("الإجمالي"), text(""), text(""), money(d.invoice.tax_total), money(d.invoice.total)],
        link: { href: `/invoices/${id}`, label: "فتح الفاتورة" },
      };
    }
    case "voucher": {
      const d = await getVoucher(ctx.supabase, h, id);
      if (!d) return { columns: [], rows: [], empty: "السند غير موجود" };
      return {
        facts: [{ label: "البيان", value: plainText(d.voucher.description) }, ...(d.voucher.reference ? [{ label: "المرجع", value: d.voucher.reference }] : [])],
        columns: ["مخصص للفاتورة", "المبلغ"],
        rows: d.allocations.map((a) => [{ text: a.invoice_number ?? "", href: `/invoices/${a.invoice_id}` }, money(a.amount)]),
        empty: "لم يُخصص السند لفواتير",
        link: { href: `/vouchers/${id}`, label: "فتح السند" },
      };
    }
    case "bill": {
      const d = await getBill(ctx.supabase, h, id);
      if (!d) return { columns: [], rows: [], empty: "الفاتورة غير موجودة" };
      const names = await accountNames(ctx, d.lines.map((l) => l.account_id));
      return {
        columns: ["البيان", "الحساب", "الكمية", "سعر الوحدة", "الضريبة", "الصافي"],
        rows: d.lines.map((l) => [text(l.description), text(names.get(l.account_id), "muted"), num(l.quantity), money(l.unit_price), money(l.tax_amount, true), money(l.net_amount)]),
        link: { href: `/bills/${id}`, label: "فتح فاتورة المورد" },
      };
    }
    case "purchase-order": {
      const { data, error } = await ctx.supabase.from("purchase_order_items")
        .select("line_no, description, account_id, quantity::text, unit_price::text").eq("po_id", id).eq("hotel_id", h).order("line_no");
      raise(error);
      const lines = data ?? [];
      const names = await accountNames(ctx, lines.map((l) => l.account_id));
      const sum = lines.reduce((a, l) => a.plus(toMoney(l.quantity).times(toMoney(l.unit_price))), toMoney(0));
      return {
        columns: ["البيان", "الحساب", "الكمية", "سعر الوحدة", "المبلغ"],
        rows: lines.map((l) => [text(l.description), text(names.get(l.account_id), "muted"), num(l.quantity), money(l.unit_price), money(toMoney(l.quantity).times(toMoney(l.unit_price)).toFixed())]),
        totals: [text("الإجمالي"), text(""), text(""), text(""), money(sum.toFixed())],
      };
    }
    case "folio": {
      const d = await getFolio(ctx.supabase, h, id);
      if (!d) return { columns: [], rows: [], empty: "الفوليو غير موجود" };
      return {
        facts: [{ label: "الرصيد", value: formatMoney(d.balance), num: true }, { label: "العربون المتاح", value: formatMoney(d.deposits), num: true }],
        columns: ["التاريخ", "النوع", "البيان", "المبلغ"],
        rows: d.transactions.map((x) => [
          { text: x.business_date, num: true }, text(t.folio.txnTypes[x.txn_type] ?? x.txn_type, "muted"), text(x.description),
          money(toMoney(x.total_amount).times(x.direction).toFixed()),
        ]),
        empty: "لا حركات بعد",
        link: { href: `/folios/${id}`, label: "فتح الفوليو" },
      };
    }
    case "reservation": {
      const d = await getReservation(ctx.supabase, h, id);
      if (!d) return { columns: [], rows: [], empty: "الحجز غير موجود" };
      const total = d.nights.reduce((a, n) => a.plus(toMoney(n.amount)), toMoney(0));
      return {
        facts: [
          ...(d.customer ? [{ label: "الشركة", value: d.customer.name_ar }] : []),
          ...(d.group ? [{ label: "المجموعة", value: d.group.name }] : []),
          ...(d.notes ? [{ label: "ملاحظات", value: plainText(d.notes) }] : []),
        ],
        columns: ["الليلة", "الموسم", "السعر", "الخصم", "المبلغ"],
        rows: d.nights.map((n) => [{ text: n.stay_date, num: true }, text(n.season_name ?? "", "muted"), money(n.rate), money(n.discount, true), money(n.amount)]),
        totals: [text("الإجمالي"), text(""), text(""), text(""), money(total.toFixed())],
        link: { href: `/reservations/${id}`, label: "فتح الحجز" },
      };
    }
    case "customer": {
      const { data, error } = await ctx.supabase.from("invoices")
        .select("id, invoice_number, issue_date, due_date, total::text, amount_due::text, status")
        .eq("hotel_id", h).eq("customer_id", id).order("issue_date", { ascending: false }).limit(50);
      raise(error);
      const due = (data ?? []).reduce((a, i) => a.plus(toMoney(i.amount_due)), toMoney(0));
      return {
        facts: [{ label: "المستحق عليه", value: formatMoney(due.toFixed()), num: true }],
        columns: ["الفاتورة", "التاريخ", "الاستحقاق", "الإجمالي", "المتبقي"],
        rows: (data ?? []).map((i) => [
          { text: i.invoice_number, num: true, href: `/invoices/${i.id}` }, { text: i.issue_date, num: true },
          { text: i.due_date ?? "", num: true }, money(i.total), money(i.amount_due, true),
        ]),
        empty: "لا فواتير لهذا العميل",
        link: { href: `/invoices?customer=${id}`, label: "كل فواتير العميل" },
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
        facts: [{ label: "المستحق له", value: formatMoney(due.toFixed()), num: true }],
        columns: ["الفاتورة", "التاريخ", "الاستحقاق", "الإجمالي", "المتبقي"],
        rows: (data ?? []).map((b) => [
          { text: b.bill_number, num: true, href: `/bills/${b.id}` }, { text: b.bill_date, num: true },
          { text: b.due_date, num: true }, money(b.total), money(rest(b).toFixed(), true),
        ]),
        empty: "لا فواتير لهذا المورد",
        link: { href: `/bills?vendor=${id}`, label: "كل فواتير المورد" },
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
      return {
        columns: ["التاريخ", "القيد", "البيان", "مدين", "دائن"],
        rows: lines.map((l) => [
          { text: l.journal_entries.entry_date, num: true },
          { text: l.journal_entries.entry_number ?? "", num: true, href: `/journal/${l.journal_entries.id}` },
          text(l.description || l.journal_entries.description), money(l.base_debit, true), money(l.base_credit, true),
        ]),
        empty: "لا حركات على الحساب في الفترة",
      };
    }
  }
}
