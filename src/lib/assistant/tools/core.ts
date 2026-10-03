import "server-only";
import { PERMISSIONS, type Permission } from "@/lib/auth/permissions";
import { isIsoDate, fiscalYearStart } from "@/lib/accounting/fiscal";
import { toPlainReport } from "@/lib/export/plain-report";
import type { DetailKind } from "@/lib/details";
import { loadDetailAction } from "@/app/(app)/_details/actions";
import { REPORTS, type ReportKey, buildReport } from "@/services/report-tables";
import { getDailyCash } from "@/services/financial.service";
import { GUIDE } from "../guide";
import { type ToolEnv, type ToolModule, asStr, denied, fn, obj, safe, str, today } from "./shared";

/** الأدوات الأساسية: دليل النظام، والتقارير، والبحث في السجلات وتفاصيلها، وسجل التدقيق، والنقدية */

export const SEARCH_KINDS = ["folio", "invoice", "voucher", "journal", "account", "customer", "vendor", "bill"] as const;
type SearchKind = (typeof SEARCH_KINDS)[number];
const DETAIL_KINDS: DetailKind[] = ["journal", "invoice", "voucher", "bill", "purchase-order", "folio", "account", "customer", "vendor"];

/** مسار الصفحة لكل نوع، ليضع المساعد رابطًا مباشرًا للسجل في إجابته */
const PATHS: Partial<Record<SearchKind, (id: string) => string>> = {
  folio: (id) => `/folios/${id}`, invoice: (id) => `/invoices/${id}`, voucher: (id) => `/vouchers/${id}`, journal: (id) => `/journal/${id}`,
  bill: (id) => `/bills/${id}`, customer: (id) => `/customers?edit=${id}`, vendor: (id) => `/vendors?edit=${id}`,
};

export const core: ToolModule = {
  specs: [
    fn("system_guide", "يقرأ جزءًا من دليل النظام الشامل: شرح الشاشات، المفاهيم الفندقية والمحاسبية، السيناريوهات، الأثر المحاسبي لكل عملية، رسائل الأخطاء وحلولها، الأسئلة الشائعة. استخدمه قبل شرح أي قسم أو خطأ.",
      obj({ id: str("معرّف الجزء من قائمة أجزاء الدليل", GUIDE.map((g) => g.id)) }, ["id"])),
    fn("hotel_snapshot", "لقطة حية للفندق الآن من كل الأقسام المتاحة للمستخدم: حركة الاستقبال والإشغال وتدقيق نهاية اليوم، والقيود المسودة، ومطابقة حسابات المراقبة، والنقدية، والموظفين. ابدأ بها لأي سؤال عام عن الوضع."),
    fn("run_report", "يشغّل تقريرًا ماليًا أو تشغيليًا بأرقامه الفعلية لفترة. الافتراضي من بداية السنة المالية حتى اليوم.",
      obj({
        report: str("التقرير", Object.keys(REPORTS)),
        from: str("بداية الفترة بصيغة YYYY-MM-DD"),
        to: str("نهاية الفترة أو تاريخ المركز بصيغة YYYY-MM-DD"),
      }, ["report"])),
    fn("search_records", "يبحث عن سجلات بالاسم أو الرقم ويعيد المعرّف ومسار الصفحة path لوضع رابط مباشر. الأنواع: فوليوهات، فواتير، سندات، قيود، حسابات، عملاء، موردون، فواتير موردين.",
      obj({ kind: str("نوع السجل", SEARCH_KINDS), query: str("نص البحث: اسم أو رقم مستند أو رمز، ويمكن تركه فارغًا لآخر السجلات") }, ["kind"])),
    fn("record_details", "تفاصيل سجل واحد بمعرّفه: سطور القيد، أصناف الفاتورة، حركات الفوليو أو الحساب، فواتير العميل أو المورد.",
      obj({
        kind: str("نوع السجل", DETAIL_KINDS),
        id: str("المعرّف uuid من search_records"),
        from: str("للحساب: بداية الفترة YYYY-MM-DD"),
        to: str("للحساب: نهاية الفترة YYYY-MM-DD"),
      }, ["kind", "id"])),
    fn("audit_trail", "آخر التغييرات المسجلة في سجل التدقيق: من غيّر ماذا ومتى، ويمكن تحديد الجدول مثل journal_entries أو invoices أو payments أو reservations.",
      obj({ table: str("اسم الجدول، اختياري") })),
    fn("cash_position", "النقدية الآن: رصيد الصندوق والبنوك في الأستاذ، ومقبوضات ومدفوعات يوم محدد حسب طريقة الدفع.",
      obj({ date: str("يوم الحركة بصيغة YYYY-MM-DD، والافتراضي اليوم") })),
  ],
  run: {
    async system_guide(_env, a) {
      const g = GUIDE.find((x) => x.id === a.id);
      return g ? { title: g.title, text: g.text } : { error: "جزء غير موجود", parts: GUIDE.map((x) => ({ id: x.id, title: x.title })) };
    },
    async run_report({ ctx, t, locale }, a) {
      const key = asStr(a.report) as ReportKey;
      if (!(key in REPORTS)) return { error: "تقرير غير معروف" };
      if (!ctx.can(REPORTS[key])) return denied("هذا التقرير");
      const now = today({ ctx, t, locale });
      const to = isIsoDate(asStr(a.to)) ? asStr(a.to) : now;
      const from = isIsoDate(asStr(a.from)) && asStr(a.from) <= to ? asStr(a.from) : fiscalYearStart(to, ctx.hotel.fiscal_year_start_month);
      const r = toPlainReport(await buildReport(key, ctx, t, locale, { from, to }), locale);
      return {
        title: r.title, period: r.subtitle, currency: ctx.hotel.base_currency, columns: r.columns, note: r.note?.text,
        rows: r.rows.map((x) => [x.kind, x.code ?? "", ...x.cells.map((c) => c.text)].join(" | ")),
      };
    },
    async search_records(env, a) {
      return search(env, asStr(a.kind) as SearchKind, safe(a.query));
    },
    async record_details(_env, a) {
      const r = await loadDetailAction({ kind: asStr(a.kind), id: asStr(a.id), from: a.from ? asStr(a.from) : undefined, to: a.to ? asStr(a.to) : undefined });
      return r.ok ? r.data : { error: r.error === "permission_denied" ? "ليست لدى المستخدم صلاحية هذا السجل" : "تعذّر جلب السجل" };
    },
    async audit_trail({ ctx }, a) {
      if (!ctx.can(PERMISSIONS.auditView)) return denied("سجل التدقيق");
      let q = ctx.supabase.from("audit_log_view").select("table_name, action, changed_fields, actor_name, occurred_at, record_id")
        .eq("hotel_id", ctx.hotel.id).order("occurred_at", { ascending: false }).limit(40);
      if (a.table) q = q.eq("table_name", asStr(a.table));
      const { data, error } = await q;
      return error ? { error: error.message } : data;
    },
    async cash_position(env, a) {
      const { ctx } = env;
      if (!ctx.can(PERMISSIONS.cashReportView)) return denied("تقارير النقدية");
      const day = isIsoDate(asStr(a.date)) ? asStr(a.date) : today(env);
      const [bal, rows] = await Promise.all([
        ctx.supabase.rpc("cash_balance", { p_hotel_id: ctx.hotel.id, p_as_of: day }),
        getDailyCash(ctx.supabase, ctx.hotel.id, day),
      ]);
      const receipts = rows.reduce((s, r) => s + Number(r.receipts), 0);
      const payments = rows.reduce((s, r) => s + Number(r.payments), 0);
      return {
        date: day, currency: ctx.hotel.base_currency,
        cash_and_bank_balance: bal.error ? null : Number(bal.data ?? 0),
        day_receipts: receipts, day_payments: payments, day_net: receipts - payments,
        by_method: rows.map((r) => ({ method: r.method_name, source: r.source === "folio" ? "فوليو" : "سند", receipts: Number(r.receipts), payments: Number(r.payments) })),
      };
    },
  },
  async snapshot({ ctx }) {
    const h = ctx.hotel.id;
    const can = (p: Permission) => ctx.can(p);
    const [drafts, recon] = await Promise.all([
      can(PERMISSIONS.journalView) ? ctx.supabase.from("journal_entries").select("id", { count: "exact", head: true }).eq("hotel_id", h).eq("status", "draft") : null,
      can(PERMISSIONS.financialView)
        ? ctx.supabase.rpc("ledger_reconciliation", { p_hotel_id: h }).select("control, gl_balance::text, subledger_balance::text, difference::text")
        : null,
    ]);
    return {
      draft_journal_entries: drafts?.count ?? null,
      ledger_reconciliation: recon && !recon.error ? recon.data : null,
    };
  },
};

async function search({ ctx }: ToolEnv, kind: SearchKind, q: string) {
  const s = ctx.supabase, h = ctx.hotel.id, like = `%${q}%`;
  const need: Record<SearchKind, Permission> = {
    folio: PERMISSIONS.folioView, invoice: PERMISSIONS.invoicesView, voucher: PERMISSIONS.paymentsView, journal: PERMISSIONS.journalView,
    account: PERMISSIONS.accountsView, customer: PERMISSIONS.customersView, vendor: PERMISSIONS.vendorsView, bill: PERMISSIONS.billsView,
  };
  if (!need[kind]) return { error: "نوع غير معروف" };
  if (!ctx.can(need[kind])) return denied("هذا النوع");
  const run = async (p: PromiseLike<{ data: unknown; error: { message: string } | null }>) => {
    const { data, error } = await p;
    if (error) return { error: error.message };
    const path = PATHS[kind];
    return Array.isArray(data) && path ? data.map((r: { id: string }) => ({ ...r, path: path(r.id) })) : data;
  };
  switch (kind) {
    case "folio": {
      let r = s.from("guest_folios").select("id, folio_number, guest_name, status, arrival_date, departure_date").eq("hotel_id", h);
      if (q) r = r.or(`folio_number.ilike.${like},guest_name.ilike.${like}`);
      return run(r.order("created_at", { ascending: false }).limit(15));
    }
    case "invoice": {
      let r = s.from("invoices").select("id, invoice_number, bill_to_name, issue_date, total::text, amount_due::text, status").eq("hotel_id", h);
      if (q) r = r.or(`invoice_number.ilike.${like},bill_to_name.ilike.${like}`);
      return run(r.order("issue_date", { ascending: false }).limit(15));
    }
    case "voucher": {
      let r = s.from("payments").select("id, voucher_number, voucher_type, payment_date, party_name, amount::text, status, description").eq("hotel_id", h);
      if (q) r = r.or(`voucher_number.ilike.${like},party_name.ilike.${like},description.ilike.${like}`);
      return run(r.order("payment_date", { ascending: false }).limit(15));
    }
    case "journal": {
      let r = s.from("journal_entries").select("id, entry_number, entry_date, description, status, source").eq("hotel_id", h);
      if (q) r = r.or(`entry_number.ilike.${like},description.ilike.${like}`);
      return run(r.order("entry_date", { ascending: false }).limit(15));
    }
    case "account": {
      let r = s.from("chart_of_accounts").select("id, code, name_ar, account_type, is_postable, is_active, system_key").eq("hotel_id", h);
      if (q) r = r.or(`code.ilike.${like},name_ar.ilike.${like}`);
      return run(r.order("code").limit(25));
    }
    case "customer": {
      let r = s.from("customers").select("id, code, name_ar, customer_type, credit_limit::text, allow_credit").eq("hotel_id", h);
      if (q) r = r.or(`code.ilike.${like},name_ar.ilike.${like}`);
      return run(r.limit(15));
    }
    case "vendor": {
      let r = s.from("vendors").select("id, code, name_ar, phone").eq("hotel_id", h);
      if (q) r = r.or(`code.ilike.${like},name_ar.ilike.${like}`);
      return run(r.limit(15));
    }
    case "bill": {
      let r = s.from("vendor_bills").select("id, bill_number, vendor_invoice_no, bill_date, due_date, total::text, amount_paid::text, status").eq("hotel_id", h);
      if (q) r = r.or(`bill_number.ilike.${like},vendor_invoice_no.ilike.${like}`);
      return run(r.order("bill_date", { ascending: false }).limit(15));
    }
  }
}
