import "server-only";
import type { AppContext } from "@/lib/auth/context";
import { PERMISSIONS, type Permission } from "@/lib/auth/permissions";
import { CONTRACT_TYPES } from "@/lib/hr/labels";
import { ID_TYPES } from "@/lib/pms/labels";
import { type ImportColumn, type RawSheet, convert, mapHeaders } from "@/lib/import/parse";
import type { HotelModule } from "@/lib/supabase/database.types";
import { raise } from "./errors";

/**
 * استيراد البيانات الأساسية من Excel: الغرف، النزلاء، العملاء، أصناف المخزون، الموظفون.
 * كل صف يُتحقق منه كاملًا قبل الحفظ (الحقول، الرموز المرجعية، التكرار في الملف وفي النظام)،
 * والحفظ دفعة واحدة: إما تُستورد كل الصفوف أو لا شيء. الإدخال بهوية المستخدم فتطبَّق صلاحياته وقواعد قاعدة البيانات.
 */

export type ImportKind = "rooms" | "guests" | "customers" | "items" | "employees";
type Values = Record<string, string | number | boolean | null>;
type Built = { row: Record<string, unknown>; key?: string } | { error: string };
type Prepared = { build: (v: Values) => Built; existing: Set<string>; keyLabel?: string };

export type ImportDefinition = {
  kind: ImportKind;
  title: string;
  description: string;
  permission: Permission;
  module?: HotelModule;
  table: string;
  columns: ImportColumn[];
  prepare: (ctx: AppContext) => Promise<Prepared>;
};

const invert = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k]));
const upper = (v: unknown) => String(v ?? "").trim().toUpperCase();
const lower = (v: unknown) => String(v ?? "").trim().toLowerCase();
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));

const CUSTOMER_TYPES = { "فرد": "individual", "شركة": "company", "وكالة سفر": "travel_agent", "منصة حجز": "ota", "جهة حكومية": "government" };

export const IMPORTS: ImportDefinition[] = [
  {
    kind: "rooms", title: "الغرف", description: "أرقام الغرف وأنواعها وطوابقها. أنشئ أنواع الغرف أولًا من إعداد الغرف.",
    permission: PERMISSIONS.pmsSetup, module: "pms", table: "rooms",
    columns: [
      { key: "room_number", header: "رقم الغرفة", kind: "text", required: true, max: 20, example: "101" },
      { key: "room_type", header: "رمز نوع الغرفة", kind: "text", required: true, example: "DBL", hint: "كما في إعداد الغرف" },
      { key: "floor", header: "الطابق", kind: "text", example: "الطابق الأول", hint: "يُنشأ تلقائيًا إن لم يوجد" },
      { key: "notes", header: "ملاحظات", kind: "text", max: 300, example: "" },
    ],
    async prepare(ctx) {
      const [types, floors, rooms] = await Promise.all([
        ctx.supabase.from("room_types").select("id, code").eq("hotel_id", ctx.hotel.id),
        ctx.supabase.from("floors").select("id, name").eq("hotel_id", ctx.hotel.id),
        ctx.supabase.from("rooms").select("room_number").eq("hotel_id", ctx.hotel.id),
      ]);
      raise(types.error); raise(floors.error); raise(rooms.error);
      const typeByCode = new Map((types.data ?? []).map((t) => [upper(t.code), t.id]));
      const floorByName = new Map((floors.data ?? []).map((f) => [lower(f.name), f.id]));
      return {
        existing: new Set((rooms.data ?? []).map((r) => lower(r.room_number))), keyLabel: "رقم الغرفة",
        build: (v) => {
          const typeId = typeByCode.get(upper(v.room_type));
          if (!typeId) return { error: `نوع الغرفة ${v.room_type} غير موجود في إعداد الغرف` };
          return {
            key: lower(v.room_number),
            row: { room_number: s(v.room_number), room_type_id: typeId, notes: s(v.notes), floor_name: v.floor ? String(v.floor) : null, floor_id: v.floor ? floorByName.get(lower(v.floor)) ?? null : null },
          };
        },
      };
    },
  },
  {
    kind: "guests", title: "النزلاء", description: "سجل النزلاء السابقين بهوياتهم وأرقامهم.",
    permission: PERMISSIONS.pmsManage, module: "pms", table: "guests",
    columns: [
      { key: "full_name", header: "الاسم الكامل", kind: "text", required: true, max: 150, example: "أحمد محمد علي" },
      { key: "phone", header: "الجوال", kind: "text", max: 40, example: "777123456" },
      { key: "email", header: "البريد", kind: "text", max: 120, example: "" },
      { key: "nationality", header: "الجنسية", kind: "text", max: 60, example: "يمني" },
      { key: "id_type", header: "نوع الهوية", kind: "enum", options: invert(ID_TYPES), example: "بطاقة شخصية" },
      { key: "id_number", header: "رقم الهوية", kind: "text", max: 40, example: "01010101010" },
      { key: "date_of_birth", header: "تاريخ الميلاد", kind: "date", example: "1990-05-20" },
      { key: "notes", header: "ملاحظات", kind: "text", max: 1000, example: "" },
    ],
    async prepare(ctx) {
      const { data, error } = await ctx.supabase.from("guests").select("id_type, id_number").eq("hotel_id", ctx.hotel.id);
      raise(error);
      return {
        existing: new Set((data ?? []).filter((g) => g.id_number).map((g) => `${g.id_type}:${upper(g.id_number)}`)), keyLabel: "الهوية",
        build: (v) => {
          if (v.id_number && !v.id_type) return { error: "اختر نوع الهوية مع رقمها" };
          return {
            key: v.id_number ? `${v.id_type}:${upper(v.id_number)}` : undefined,
            row: { full_name: s(v.full_name), phone: s(v.phone), email: s(v.email), nationality: s(v.nationality), id_type: v.id_type ?? null,
              id_number: s(v.id_number), date_of_birth: v.date_of_birth ?? null, notes: s(v.notes) },
          };
        },
      };
    },
  },
  {
    kind: "customers", title: "العملاء", description: "الشركات والجهات والأفراد الذين تتعامل معهم بالآجل.",
    permission: PERMISSIONS.customersManage, table: "customers",
    columns: [
      { key: "code", header: "الرمز", kind: "text", required: true, max: 20, example: "C001" },
      { key: "name_ar", header: "الاسم بالعربية", kind: "text", required: true, max: 200, example: "شركة الأمل للتجارة" },
      { key: "name_en", header: "الاسم بالإنجليزية", kind: "text", max: 200, example: "Al Amal Trading" },
      { key: "customer_type", header: "النوع", kind: "enum", options: CUSTOMER_TYPES, example: "شركة", hint: "شركة إن تُرك فارغًا" },
      { key: "tax_number", header: "الرقم الضريبي", kind: "text", max: 50, example: "" },
      { key: "commercial_registration", header: "السجل التجاري", kind: "text", max: 50, example: "" },
      { key: "phone", header: "الهاتف", kind: "text", max: 50, example: "01234567" },
      { key: "email", header: "البريد", kind: "text", max: 200, example: "" },
      { key: "address", header: "العنوان", kind: "text", max: 500, example: "صنعاء" },
      { key: "allow_credit", header: "يسمح بالآجل", kind: "bool", example: "نعم", hint: "نعم أو لا، ولا إن تُرك فارغًا" },
      { key: "credit_limit", header: "الحد الائتماني", kind: "number", example: "500000" },
      { key: "payment_terms_days", header: "مدة السداد بالأيام", kind: "number", example: "30", hint: "30 إن تُرك فارغًا" },
    ],
    async prepare(ctx) {
      const { data, error } = await ctx.supabase.from("customers").select("code").eq("hotel_id", ctx.hotel.id);
      raise(error);
      return {
        existing: new Set((data ?? []).map((c) => upper(c.code))), keyLabel: "الرمز",
        build: (v) => {
          const code = upper(v.code);
          if (!/^[A-Z0-9_-]{1,20}$/.test(code)) return { error: "الرمز حروف إنجليزية وأرقام فقط" };
          const terms = v.payment_terms_days === null ? 30 : Number(v.payment_terms_days);
          if (!Number.isInteger(terms) || terms > 365) return { error: "مدة السداد عدد أيام صحيح حتى 365" };
          return {
            key: code,
            row: { code, name_ar: s(v.name_ar), name_en: s(v.name_en), customer_type: v.customer_type ?? "company", tax_number: s(v.tax_number),
              commercial_registration: s(v.commercial_registration), phone: s(v.phone), email: s(v.email), address: s(v.address),
              allow_credit: v.allow_credit ?? false, credit_limit: v.credit_limit ?? null, payment_terms_days: terms, is_active: true },
          };
        },
      };
    },
  },
  {
    kind: "items", title: "أصناف المخزون", description: "بطاقات الأصناف بلا كميات. الكميات الافتتاحية تُسجَّل من الأرصدة الافتتاحية أو استلام المخزون.",
    permission: PERMISSIONS.inventoryManage, module: "accounting", table: "inventory_items",
    columns: [
      { key: "sku", header: "رمز الصنف", kind: "text", required: true, max: 30, example: "RICE-5KG" },
      { key: "name_ar", header: "الاسم بالعربية", kind: "text", required: true, max: 200, example: "أرز بسمتي 5 كجم" },
      { key: "name_en", header: "الاسم بالإنجليزية", kind: "text", max: 200, example: "Basmati rice 5kg" },
      { key: "unit", header: "الوحدة", kind: "text", required: true, max: 20, example: "كيس" },
      { key: "reorder_level", header: "حد إعادة الطلب", kind: "number", example: "10" },
      { key: "inventory_account", header: "رمز حساب المخزون", kind: "text", example: "1120", hint: "مخزون المستلزمات العامة إن تُرك فارغًا" },
      { key: "expense_account", header: "رمز حساب الصرف", kind: "text", example: "5101", hint: "الحساب الذي يُحمَّل عند صرف الصنف" },
    ],
    async prepare(ctx) {
      const [items, accounts] = await Promise.all([
        ctx.supabase.from("inventory_items").select("sku").eq("hotel_id", ctx.hotel.id),
        ctx.supabase.from("chart_of_accounts").select("id, code, account_type, is_postable, system_key").eq("hotel_id", ctx.hotel.id),
      ]);
      raise(items.error); raise(accounts.error);
      const acc = accounts.data ?? [];
      const byCode = new Map(acc.map((a) => [String(a.code), a]));
      const defaultInventory = acc.find((a) => a.system_key === "inventory_supplies");
      return {
        existing: new Set((items.data ?? []).map((i) => upper(i.sku))), keyLabel: "رمز الصنف",
        build: (v) => {
          const sku = upper(v.sku);
          if (!/^[A-Z0-9_.-]{1,30}$/.test(sku)) return { error: "رمز الصنف حروف إنجليزية وأرقام فقط" };
          const inv = v.inventory_account ? byCode.get(String(v.inventory_account)) : defaultInventory;
          if (!inv || !inv.is_postable || inv.account_type !== "asset") return { error: `حساب المخزون ${v.inventory_account ?? ""} غير موجود أو ليس حساب أصول تفصيليًا` };
          if (!v.expense_account) return { error: "رمز حساب الصرف مطلوب" };
          const exp = byCode.get(String(v.expense_account));
          if (!exp || !exp.is_postable || exp.account_type !== "expense") return { error: `حساب الصرف ${v.expense_account} غير موجود أو ليس حساب مصروف تفصيليًا` };
          return {
            key: sku,
            row: { sku, name_ar: s(v.name_ar), name_en: s(v.name_en), unit: s(v.unit), reorder_level: v.reorder_level ?? "0",
              inventory_account_id: inv.id, expense_account_id: exp.id, is_active: true },
          };
        },
      };
    },
  },
  {
    kind: "employees", title: "الموظفون", description: "ملفات الموظفين برواتبهم الأساسية. البدلات تُضاف من ملف كل موظف.",
    permission: PERMISSIONS.hrManage, module: "accounting", table: "hr_employees",
    columns: [
      { key: "code", header: "الرقم الوظيفي", kind: "text", max: 20, example: "", hint: "يُعطى تلقائيًا إن تُرك فارغًا" },
      { key: "full_name", header: "الاسم الكامل", kind: "text", required: true, max: 120, example: "سالم أحمد ناصر" },
      { key: "job_title", header: "المسمى الوظيفي", kind: "text", max: 120, example: "موظف استقبال" },
      { key: "department", header: "رمز القسم", kind: "text", required: true, example: "ROOMS", hint: "كما في أقسام الفندق" },
      { key: "phone", header: "الجوال", kind: "text", max: 40, example: "771234567" },
      { key: "email", header: "البريد", kind: "text", max: 120, example: "" },
      { key: "nationality", header: "الجنسية", kind: "text", max: 60, example: "يمني" },
      { key: "id_number", header: "رقم الهوية", kind: "text", max: 40, example: "" },
      { key: "id_expiry", header: "انتهاء الهوية", kind: "date", example: "" },
      { key: "birth_date", header: "تاريخ الميلاد", kind: "date", example: "1995-03-01" },
      { key: "hire_date", header: "تاريخ التعيين", kind: "date", required: true, example: "2024-01-01" },
      { key: "contract_type", header: "نوع العقد", kind: "enum", options: invert(CONTRACT_TYPES), example: "دائم", hint: "دائم إن تُرك فارغًا" },
      { key: "contract_end", header: "نهاية العقد", kind: "date", example: "" },
      { key: "basic_salary", header: "الراتب الأساسي", kind: "number", required: true, example: "150000" },
    ],
    async prepare(ctx) {
      const [emps, deps] = await Promise.all([
        ctx.supabase.from("hr_employees").select("code").eq("hotel_id", ctx.hotel.id),
        ctx.supabase.from("departments").select("id, code, name_ar").eq("hotel_id", ctx.hotel.id),
      ]);
      raise(emps.error); raise(deps.error);
      const depBy = new Map<string, string>();
      for (const d of deps.data ?? []) { depBy.set(upper(d.code), d.id); depBy.set(upper(d.name_ar), d.id); }
      return {
        existing: new Set((emps.data ?? []).map((e) => upper(e.code))), keyLabel: "الرقم الوظيفي",
        build: (v) => {
          const code = v.code ? String(v.code).trim() : "";
          if (code && !/^[A-Za-z0-9_-]{1,20}$/.test(code)) return { error: "الرقم الوظيفي حروف إنجليزية وأرقام فقط" };
          if (String(v.full_name ?? "").trim().length < 2) return { error: "الاسم الكامل حرفان على الأقل" };
          const dep = depBy.get(upper(v.department));
          if (!dep) return { error: `القسم ${v.department} غير موجود` };
          if (v.contract_end && v.hire_date && String(v.contract_end) < String(v.hire_date)) return { error: "نهاية العقد قبل تاريخ التعيين" };
          return {
            key: code ? code.toUpperCase() : undefined,
            row: { code, full_name: s(v.full_name), job_title: s(v.job_title), department_id: dep, phone: s(v.phone), email: s(v.email),
              nationality: s(v.nationality), id_number: s(v.id_number), id_expiry: v.id_expiry ?? null, birth_date: v.birth_date ?? null,
              hire_date: v.hire_date, contract_type: v.contract_type ?? "permanent", contract_end: v.contract_end ?? null, basic_salary: v.basic_salary },
          };
        },
      };
    },
  },
];

export const importDefinition = (kind: string) => IMPORTS.find((d) => d.kind === kind);

/** الأنواع المتاحة للمستخدم: حسب صلاحياته والأقسام المفعّلة للفندق */
export function availableImports(ctx: AppContext): ImportDefinition[] {
  const modules = ctx.hotel.enabled_modules ?? ["accounting", "pms"];
  return IMPORTS.filter((d) => ctx.can(d.permission) && (!d.module || modules.includes(d.module)));
}

export type ImportCheck = {
  total: number;
  valid: number;
  errors: { line: number; message: string }[];
  missingColumns: string[];
  ignoredColumns: string[];
  preview: { line: number; cells: string[] }[];
};

/** يتحقق من كل الصفوف؛ يرجع الصفوف الجاهزة للحفظ مع تقرير الفحص */
export async function checkImport(ctx: AppContext, def: ImportDefinition, sheet: RawSheet): Promise<{ check: ImportCheck; rows: Record<string, unknown>[] }> {
  const { index, missing, unknown } = mapHeaders(sheet.headers, def.columns);
  const check: ImportCheck = { total: sheet.rows.length, valid: 0, errors: [], missingColumns: missing, ignoredColumns: unknown, preview: [] };
  if (missing.length) return { check, rows: [] };
  const prep = await def.prepare(ctx);
  const seen = new Map<string, number>();
  const rows: Record<string, unknown>[] = [];
  for (const r of sheet.rows) {
    const values: Values = {};
    const errs: string[] = [];
    for (const col of def.columns) {
      const i = index.get(col.key);
      const out = convert(col, i === undefined ? "" : r.cells[i] ?? "");
      if ("error" in out) errs.push(out.error); else values[col.key] = out.value;
    }
    if (!errs.length) {
      const b = prep.build(values);
      if ("error" in b) errs.push(b.error);
      else {
        if (b.key && prep.existing.has(b.key)) errs.push(`${prep.keyLabel} موجود مسبقًا في النظام`);
        else if (b.key && seen.has(b.key)) errs.push(`${prep.keyLabel} مكرر مع الصف ${seen.get(b.key)}`);
        else {
          if (b.key) seen.set(b.key, r.line);
          rows.push(b.row);
        }
      }
    }
    if (errs.length) for (const message of errs) check.errors.push({ line: r.line, message });
    else {
      check.valid++;
      if (check.preview.length < 8) check.preview.push({ line: r.line, cells: def.columns.map((c) => { const i = index.get(c.key); return i === undefined ? "" : r.cells[i] ?? ""; }) });
    }
  }
  check.errors = check.errors.slice(0, 200);
  return { check, rows };
}

/** الحفظ دفعة واحدة؛ الطوابق الجديدة للغرف تُنشأ أولًا */
export async function runImport(ctx: AppContext, def: ImportDefinition, rows: Record<string, unknown>[]): Promise<number> {
  if (!rows.length) return 0;
  let payload = rows;
  const createdFloors: string[] = [];
  if (def.kind === "rooms") {
    const newFloors = [...new Set(rows.filter((r) => r.floor_name && !r.floor_id).map((r) => String(r.floor_name)))];
    const floorIds = new Map<string, string>();
    if (newFloors.length) {
      const { data, error } = await ctx.supabase.from("floors").insert(newFloors.map((name) => ({ hotel_id: ctx.hotel.id, name }))).select("id, name");
      raise(error);
      for (const f of data ?? []) { floorIds.set(lower(f.name), f.id); createdFloors.push(f.id); }
    }
    payload = rows.map(({ floor_name, ...r }) => ({ ...r, floor_id: r.floor_id ?? (floor_name ? floorIds.get(lower(floor_name)) ?? null : null) }));
  }
  const { error } = await ctx.supabase.from(def.table as "rooms").insert(payload.map((r) => ({ ...r, hotel_id: ctx.hotel.id })) as never);
  if (error && createdFloors.length) {
    // فشل الحفظ: تُحذف الطوابق التي أُنشئت لهذا الاستيراد فلا يبقى منه شيء
    await ctx.supabase.from("floors").delete().in("id", createdFloors).eq("hotel_id", ctx.hotel.id);
  }
  raise(error);
  return payload.length;
}
