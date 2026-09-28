import "server-only";
import type { AppContext } from "@/lib/auth/context";
import { PERMISSIONS, type Permission } from "@/lib/auth/permissions";
import { isIsoDate, todayInTimeZone, fiscalYearStart } from "@/lib/accounting/fiscal";
import { toPlainReport } from "@/lib/export/plain-report";
import type { DetailKind } from "@/lib/details";
import { loadDetailAction } from "@/app/(app)/_details/actions";
import { frontDeskSummary, nightAuditStatus } from "@/services/pms.service";
import { REPORTS, type ReportKey, buildReport } from "@/services/report-tables";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import { GUIDE } from "./guide";
import type { ToolSpec } from "./provider";

/**
 * أدوات المساعد: قراءة فقط، وكلها تعمل بجلسة المستخدم نفسه فتطبق صلاحياته وحماية قاعدة البيانات (RLS).
 * لا توجد أداة تنشئ أو تعدّل أو تحذف شيئًا.
 */

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
const str = (description: string, e?: string[]) => ({ type: "string", description, ...(e ? { enum: e } : {}) });

const SEARCH_KINDS = ["reservation", "guest", "folio", "invoice", "voucher", "journal", "account", "customer", "vendor", "bill"] as const;
type SearchKind = (typeof SEARCH_KINDS)[number];
const DETAIL_KINDS: DetailKind[] = ["journal", "invoice", "voucher", "bill", "purchase-order", "folio", "reservation", "account", "customer", "vendor"];

export const TOOL_SPECS: ToolSpec[] = [
  { type: "function", function: {
    name: "system_guide",
    description: "يقرأ جزءًا من دليل النظام الشامل: شرح الشاشات، المفاهيم الفندقية والمحاسبية، السيناريوهات، الأثر المحاسبي لكل عملية، رسائل الأخطاء وحلولها، الأسئلة الشائعة. استخدمه قبل شرح أي قسم أو خطأ.",
    parameters: obj({ id: str("معرّف الجزء من قائمة أجزاء الدليل", GUIDE.map((g) => g.id)) }, ["id"]),
  } },
  { type: "function", function: {
    name: "hotel_snapshot",
    description: "لقطة حية للفندق الآن: الوصول والمغادرة والمقيمون والإشغال والغرف غير النظيفة، حالة تدقيق نهاية اليوم والليالي غير المرحلة، الورديات المفتوحة، القيود المسودة، ومطابقة حسابات المراقبة مع دفاترها الفرعية.",
    parameters: obj({}),
  } },
  { type: "function", function: {
    name: "run_report",
    description: "يشغّل تقريرًا ماليًا أو تشغيليًا بأرقامه الفعلية لفترة. الافتراضي من بداية السنة المالية حتى اليوم.",
    parameters: obj({
      report: str("التقرير", Object.keys(REPORTS)),
      from: str("بداية الفترة بصيغة YYYY-MM-DD"),
      to: str("نهاية الفترة أو تاريخ المركز بصيغة YYYY-MM-DD"),
    }, ["report"]),
  } },
  { type: "function", function: {
    name: "search_records",
    description: "يبحث عن سجلات بالاسم أو الرقم: حجوزات، نزلاء، فوليوهات، فواتير، سندات، قيود، حسابات، عملاء، موردون، فواتير موردين. يعيد المعرّف لاستخدامه مع record_details.",
    parameters: obj({ kind: str("نوع السجل", [...SEARCH_KINDS]), query: str("نص البحث: اسم أو رقم مستند أو رمز، ويمكن تركه فارغًا لآخر السجلات") }, ["kind"]),
  } },
  { type: "function", function: {
    name: "record_details",
    description: "تفاصيل سجل واحد بمعرّفه: سطور القيد، أصناف الفاتورة، حركات الفوليو أو الحساب، ليالي الحجز، فواتير العميل أو المورد.",
    parameters: obj({
      kind: str("نوع السجل", DETAIL_KINDS),
      id: str("المعرّف uuid من search_records"),
      from: str("للحساب: بداية الفترة YYYY-MM-DD"),
      to: str("للحساب: نهاية الفترة YYYY-MM-DD"),
    }, ["kind", "id"]),
  } },
  { type: "function", function: {
    name: "audit_trail",
    description: "آخر التغييرات المسجلة في سجل التدقيق: من غيّر ماذا ومتى، ويمكن تحديد الجدول مثل journal_entries أو reservations أو payments.",
    parameters: obj({ table: str("اسم الجدول، اختياري") }),
  } },
];

const MAX_OUTPUT = 14_000;
const clip = (v: unknown) => {
  const s = JSON.stringify(v);
  return s.length > MAX_OUTPUT ? `${s.slice(0, MAX_OUTPUT)}… (اختُصرت النتيجة)` : s;
};
const denied = (what: string) => clip({ error: `ليست لدى المستخدم صلاحية ${what}` });
const safe = (q: string) => q.replace(/[%,()*]/g, " ").trim();

export async function runTool(ctx: AppContext, t: Dictionary, locale: string, name: string, rawArgs: string): Promise<string> {
  let args: Record<string, string | undefined>;
  try { args = rawArgs ? JSON.parse(rawArgs) : {}; } catch { return clip({ error: "معطيات الأداة غير صالحة" }); }
  try {
    switch (name) {
      case "system_guide": {
        const g = GUIDE.find((x) => x.id === args.id);
        return g ? clip({ title: g.title, text: g.text }) : clip({ error: "جزء غير موجود", parts: GUIDE.map((x) => ({ id: x.id, title: x.title })) });
      }
      case "hotel_snapshot": return clip(await snapshot(ctx));
      case "run_report": {
        const key = args.report as ReportKey;
        if (!(key in REPORTS)) return clip({ error: "تقرير غير معروف" });
        if (!ctx.can(REPORTS[key])) return denied("هذا التقرير");
        const today = todayInTimeZone(ctx.hotel.timezone);
        const to = args.to && isIsoDate(args.to) ? args.to : today;
        const from = args.from && isIsoDate(args.from) && args.from <= to ? args.from : fiscalYearStart(to, ctx.hotel.fiscal_year_start_month);
        const r = toPlainReport(await buildReport(key, ctx, t, locale, { from, to }), locale);
        return clip({
          title: r.title, period: r.subtitle, currency: ctx.hotel.base_currency, columns: r.columns, note: r.note?.text,
          rows: r.rows.map((x) => [x.kind, x.code ?? "", ...x.cells.map((c) => c.text)].join(" | ")),
        });
      }
      case "search_records": return clip(await search(ctx, args.kind as SearchKind, safe(args.query ?? "")));
      case "record_details": {
        const r = await loadDetailAction({ kind: args.kind, id: args.id, from: args.from, to: args.to });
        return clip(r.ok ? r.data : { error: r.error === "permission_denied" ? "ليست لدى المستخدم صلاحية هذا السجل" : "تعذّر جلب السجل" });
      }
      case "audit_trail": {
        if (!ctx.can(PERMISSIONS.auditView)) return denied("سجل التدقيق");
        let q = ctx.supabase.from("audit_log_view").select("table_name, action, changed_fields, actor_name, occurred_at, record_id")
          .eq("hotel_id", ctx.hotel.id).order("occurred_at", { ascending: false }).limit(40);
        if (args.table) q = q.eq("table_name", args.table);
        const { data, error } = await q;
        return clip(error ? { error: error.message } : data);
      }
      default: return clip({ error: "أداة غير معروفة" });
    }
  } catch (e) {
    return clip({ error: e instanceof Error ? e.message : "خطأ غير متوقع" });
  }
}

async function snapshot(ctx: AppContext) {
  const h = ctx.hotel.id;
  const can = (p: Permission) => ctx.can(p);
  const [desk, audit, drafts, recon] = await Promise.all([
    can(PERMISSIONS.pmsView) ? frontDeskSummary(ctx.supabase, h).catch(() => null) : null,
    can(PERMISSIONS.pmsView) ? nightAuditStatus(ctx.supabase, h).catch(() => null) : null,
    can(PERMISSIONS.journalView) ? ctx.supabase.from("journal_entries").select("id", { count: "exact", head: true }).eq("hotel_id", h).eq("status", "draft") : null,
    can(PERMISSIONS.financialView)
      ? ctx.supabase.rpc("ledger_reconciliation", { p_hotel_id: h }).select("control, gl_balance::text, subledger_balance::text, difference::text")
      : null,
  ]);
  return {
    hotel: ctx.hotel.name_ar, today: todayInTimeZone(ctx.hotel.timezone), base_currency: ctx.hotel.base_currency,
    front_desk: desk ?? "لا صلاحية أو القسم غير مفعّل",
    night_audit: audit ? {
      business_date: audit.date, done: audit.done, last_audit: audit.last_audit, unposted_nights: audit.unposted_nights,
      unposted_amount: audit.unposted_amount, pending_no_shows: audit.pending_no_shows.length, overstays: audit.overstays.length,
      open_shifts: audit.open_shifts, occupancy: audit.stats,
    } : "لا صلاحية أو القسم غير مفعّل",
    draft_journal_entries: drafts?.count ?? null,
    ledger_reconciliation: recon && !recon.error ? recon.data : null,
  };
}

async function search(ctx: AppContext, kind: SearchKind, q: string) {
  const s = ctx.supabase, h = ctx.hotel.id, like = `%${q}%`;
  const need: Record<SearchKind, Permission> = {
    reservation: PERMISSIONS.pmsView, guest: PERMISSIONS.pmsView, folio: PERMISSIONS.folioView, invoice: PERMISSIONS.invoicesView,
    voucher: PERMISSIONS.paymentsView, journal: PERMISSIONS.journalView, account: PERMISSIONS.accountsView,
    customer: PERMISSIONS.customersView, vendor: PERMISSIONS.vendorsView, bill: PERMISSIONS.billsView,
  };
  if (!need[kind]) return { error: "نوع غير معروف" };
  if (!ctx.can(need[kind])) return { error: "ليست لدى المستخدم صلاحية هذا النوع" };
  const run = async (p: PromiseLike<{ data: unknown; error: { message: string } | null }>) => {
    const { data, error } = await p;
    return error ? { error: error.message } : data;
  };
  switch (kind) {
    case "reservation": {
      let r = s.from("reservations").select("id, confirmation_number, status, arrival_date, departure_date, total_amount::text, guest:guests(full_name), room:rooms(room_number)").eq("hotel_id", h);
      if (q) r = r.or(`confirmation_number.ilike.${like}`);
      const byNumber = await run(r.order("arrival_date", { ascending: false }).limit(15));
      if (!q || (Array.isArray(byNumber) && byNumber.length)) return byNumber;
      const { data: guests } = await s.from("guests").select("id").eq("hotel_id", h).ilike("full_name", like).limit(20);
      const ids = (guests ?? []).map((g) => g.id);
      return ids.length ? run(s.from("reservations").select("id, confirmation_number, status, arrival_date, departure_date, total_amount::text, guest:guests(full_name), room:rooms(room_number)")
        .eq("hotel_id", h).in("guest_id", ids).order("arrival_date", { ascending: false }).limit(15)) : [];
    }
    case "guest": {
      let r = s.from("guests").select("id, full_name, phone, nationality, is_blacklisted").eq("hotel_id", h);
      if (q) r = r.or(`full_name.ilike.${like},phone.ilike.${like},id_number.ilike.${like}`);
      return run(r.limit(15));
    }
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
