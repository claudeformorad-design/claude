import { z } from "zod";
import { isIsoDate } from "@/lib/accounting/fiscal";
import { isValidAmount, toMoney } from "@/lib/accounting/money";

/**
 * مخططات Zod لوحدات المرحلة 2. قاعدة البيانات تعيد التحقق من كل القواعد المالية
 * (الأرصدة، الحدود الائتمانية، الصلاحيات)؛ هنا نتحقق من الشكل لتغذية راجعة سريعة.
 */
const text = (max = 200) => z.string().trim().max(max);
// الحقول الاختيارية تقبل الغياب (حقل غير معروض في النموذج) أو النص الفارغ ⇒ null
const optionalText = (max = 500) =>
  z.string().trim().max(max).optional().transform((v) => (v === undefined || v === "" ? null : v));
const optionalUuid = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === undefined || v === "" ? null : v))
  .pipe(z.uuid().nullable());
const code = z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,20}$/, "code_format");
const positiveAmount = z.string().trim().refine((v) => isValidAmount(v) && toMoney(v).gt(0), "invalid_amount").transform((v) => toMoney(v).toFixed());
const optionalAmount = z
  .string()
  .trim()
  .optional()
  .refine((v) => v === undefined || v === "" || (isValidAmount(v) && !toMoney(v).isNegative()), "invalid_amount")
  .transform((v) => (v === undefined || v === "" ? null : toMoney(v).toFixed()));
const optionalDate = z
  .string()
  .trim()
  .optional()
  .refine((v) => v === undefined || v === "" || isIsoDate(v), "invalid_date")
  .transform((v) => (v === undefined || v === "" ? null : v));

// ----------------------------------------------------------------------------- الإعدادات
export const taxRateFormSchema = z.object({
  id: z.uuid().optional(),
  code,
  name_ar: text().min(1),
  name_en: optionalText(200),
  kind: z.enum(["vat", "tourism_fee", "municipality_fee", "service_charge", "other"]),
  rate: z.string().trim().refine((v) => isValidAmount(v) && toMoney(v).gte(0) && toMoney(v).lte(100), "invalid_amount").transform((v) => toMoney(v).toFixed()),
  is_compound: z.boolean(),
  account_id: z.uuid(),
  is_active: z.boolean(),
});
export type TaxRateFormValues = z.output<typeof taxRateFormSchema>;

export const paymentMethodFormSchema = z.object({
  id: z.uuid().optional(),
  code,
  name_ar: text().min(1),
  name_en: optionalText(200),
  kind: z.enum(["cash", "card", "bank_transfer", "cheque", "e_wallet", "city_ledger"]),
  account_id: z.uuid(),
  // عملة أجنبية للطريقة (فارغ = العملة الأساسية)
  currency_code: z.string().trim().toUpperCase().optional().nullable().transform((v) => (v && /^[A-Z]{3}$/.test(v) ? v : null)),
  is_active: z.boolean(),
});
export type PaymentMethodFormValues = z.output<typeof paymentMethodFormSchema>;

export const chargeCodeFormSchema = z.object({
  id: z.uuid().optional(),
  code,
  name_ar: text().min(1),
  name_en: optionalText(200),
  category: z.enum(["room", "food", "beverage", "minibar", "spa", "events", "shop", "transport", "tours", "laundry", "parking", "telephone", "other"]),
  department_id: z.uuid(),
  revenue_account_id: z.uuid(),
  default_price: optionalAmount,
  price_includes_tax: z.boolean(),
  tax_rate_ids: z.array(z.uuid()),
  is_active: z.boolean(),
});
export type ChargeCodeFormValues = z.output<typeof chargeCodeFormSchema>;

export const customerFormSchema = z.object({
  id: z.uuid().optional(),
  code,
  name_ar: text().min(1),
  name_en: optionalText(200),
  customer_type: z.enum(["individual", "company", "travel_agent", "ota", "government"]),
  tax_number: optionalText(50),
  commercial_registration: optionalText(50),
  email: optionalText(200),
  phone: optionalText(50),
  address: optionalText(500),
  allow_credit: z.boolean(),
  credit_limit: optionalAmount,
  payment_terms_days: z.coerce.number().int().min(0).max(365),
  notes: optionalText(1000),
  is_active: z.boolean(),
});
export type CustomerFormInput = z.input<typeof customerFormSchema>;
export type CustomerFormValues = z.output<typeof customerFormSchema>;

// ----------------------------------------------------------------------------- الفوليو
export const openFolioSchema = z
  .object({
    guest_name: text().min(1),
    folio_type: z.enum(["guest", "master", "company", "non_guest"]),
    customer_id: optionalUuid,
    room_number: optionalText(20),
    reservation_ref: optionalText(50),
    arrival_date: optionalDate,
    departure_date: optionalDate,
    adults: z.string().trim().transform((v) => (v === "" ? null : Number(v))).pipe(z.number().int().positive().nullable()),
    master_folio_id: optionalUuid,
    notes: optionalText(1000),
  })
  .refine((v) => !v.arrival_date || !v.departure_date || v.departure_date >= v.arrival_date, {
    path: ["departure_date"],
    message: "invalid_date",
  });
export type OpenFolioInput = z.input<typeof openFolioSchema>;

/** إجراءات الفوليو — اتحاد مميز بحقل kind */
export const folioActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("charge"),
    charge_code_id: z.uuid(),
    quantity: positiveAmount,
    unit_price: positiveAmount,
    description: optionalText(300),
    reference: optionalText(100),
  }),
  z.object({
    kind: z.enum(["payment", "deposit", "refund", "depositRefund"]),
    payment_method_id: z.uuid(),
    amount: positiveAmount,
    reference: optionalText(100),
    customer_id: optionalUuid,
  }),
  z.object({ kind: z.literal("allowance"), charge_txn_id: z.uuid(), amount: positiveAmount, reason: text(300).min(1) }),
  z.object({ kind: z.literal("transfer"), to_folio_id: z.uuid(), amount: positiveAmount, description: optionalText(300) }),
  z.object({ kind: z.literal("void"), txn_id: z.uuid(), reason: text(300).min(1) }),
]);
export type FolioAction = z.infer<typeof folioActionSchema>;

// ----------------------------------------------------------------------------- الفواتير والسندات
export const directInvoiceSchema = z.object({
  customer_id: z.uuid(),
  issue_date: optionalDate,
  notes: optionalText(1000),
  lines: z
    .array(z.object({ charge_code_id: z.uuid(), description: optionalText(300), quantity: positiveAmount, unit_price: positiveAmount }))
    .min(1),
});
export type DirectInvoiceInput = z.input<typeof directInvoiceSchema>;

export const voucherSchema = z
  .object({
    voucher_type: z.enum(["receipt", "disbursement"]),
    party_type: z.enum(["customer", "account"]),
    payment_method_id: z.uuid(),
    amount: positiveAmount,
    payment_date: optionalDate,
    customer_id: optionalUuid,
    counter_account_id: optionalUuid,
    department_id: optionalUuid,
    party_name: optionalText(200),
    reference: optionalText(100),
    description: text(500).min(1),
    allocations: z.array(z.object({ invoice_id: z.uuid(), amount: positiveAmount })),
  })
  .refine((v) => (v.party_type === "customer" ? !!v.customer_id : !!v.counter_account_id), {
    path: ["party_type"],
    message: "required",
  });
export type VoucherInput = z.input<typeof voucherSchema>;
