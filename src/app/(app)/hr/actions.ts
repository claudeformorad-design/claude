"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { isIsoDate } from "@/lib/accounting/fiscal";
import { isValidAmount, toMoney } from "@/lib/accounting/money";
import { raise, type ActionResult, toActionResult, invalid } from "@/services/errors";
import { settlementQuote, type SettlementQuote } from "@/services/hr.service";

/** عمليات الموارد البشرية: التحقق من الشكل هنا، والقواعد والحسابات كلها في قاعدة البيانات */
const fail = { ok: false as const, error: "validation" as const };
const uuid = z.uuid();
const optUuid = z.union([uuid, z.literal("")]).optional().transform((v) => v || null);
const date = z.string().refine(isIsoDate);
const optDate = z.union([date, z.literal("")]).optional().transform((v) => v || null);
const text = (max = 120) => z.string().trim().max(max).optional().transform((v) => v || null);
const amount = (min0 = true) => z.union([z.string(), z.number()]).transform(String).refine((v) => isValidAmount(v.trim()) && (min0 ? !toMoney(v.trim()).isNegative() : toMoney(v.trim()).gt(0)))
  .transform((v) => toMoney(v.trim()).toFixed());
const num = (min: number, max: number) => z.union([z.string(), z.number()]).transform(Number).refine((v) => Number.isFinite(v) && v >= min && v <= max);
const bool = z.union([z.boolean(), z.literal("on"), z.literal("")]).optional().transform((v) => v === true || v === "on");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const optTime = z.union([time, z.literal("")]).optional().transform((v) => v || "");

async function run<T>(permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS], paths: string[], fn: (ctx: Awaited<ReturnType<typeof requireAppContext>>) => Promise<T>): Promise<ActionResult<T>> {
  const ctx = await requireAppContext(permission);
  const r = await toActionResult(() => fn(ctx));
  if (r.ok) for (const p of paths) revalidatePath(p, "layout");
  return r;
}
const M = PERMISSIONS.hrManage;

// ----------------------------------------------------------------------------- الموظفون
const employeeSchema = z.object({
  id: optUuid, code: z.string().trim().max(20).regex(/^[A-Za-z0-9_-]*$/).optional().transform((v) => v || ""),
  full_name: z.string().trim().min(2).max(120), job_title: text(), department_id: uuid, phone: text(40), email: text(), nationality: text(60),
  id_number: text(40), id_expiry: optDate, birth_date: optDate, hire_date: date,
  contract_type: z.enum(["permanent", "fixed", "part_time"]), contract_end: optDate, basic_salary: amount(), shift_id: optUuid, notes: text(500),
});

export async function saveEmployeeAction(input: unknown): Promise<ActionResult<string>> {
  const p = employeeSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { id, ...row } = p.data;
  return run(M, ["/hr"], async (ctx) => {
    if (id) {
      const { error } = await ctx.supabase.from("hr_employees").update({ ...row, code: row.code || undefined }).eq("id", id).eq("hotel_id", ctx.hotel.id);
      raise(error);
      return id;
    }
    const { data, error } = await ctx.supabase.from("hr_employees").insert({ ...row, hotel_id: ctx.hotel.id }).select("id").single();
    raise(error);
    return data!.id as string;
  });
}

export async function saveEmployeeComponentsAction(employeeId: string, rows: { component_id: string; value: string }[]): Promise<ActionResult> {
  const p = z.object({ employeeId: uuid, rows: z.array(z.object({ component_id: uuid, value: z.union([amount(), z.literal("")]) })).max(50) }).safeParse({ employeeId, rows });
  if (!p.success) return invalid(p.error);
  return run(M, ["/hr"], async (ctx) => {
    raise((await ctx.supabase.rpc("hr_save_employee_components", { p_employee_id: p.data.employeeId, p_rows: p.data.rows })).error);
    return undefined;
  });
}

// ----------------------------------------------------------------------------- الحضور والورديات
export async function saveAttendanceAction(day: string, rows: { employee_id: string; status: string; check_in: string; check_out: string; notes: string }[]): Promise<ActionResult<number>> {
  const p = z.object({
    day: date,
    rows: z.array(z.object({ employee_id: uuid, status: z.enum(["present", "absent", "leave", "off"]), check_in: optTime, check_out: optTime, notes: z.string().max(300) })).max(1000),
  }).safeParse({ day, rows });
  if (!p.success) return invalid(p.error);
  return run(M, ["/hr/attendance"], async (ctx) => {
    const { data, error } = await ctx.supabase.rpc("hr_save_attendance", { p_hotel_id: ctx.hotel.id, p_date: p.data.day, p_rows: p.data.rows });
    raise(error);
    return Number(data ?? 0);
  });
}

export async function saveRosterAction(rows: { employee_id: string; work_date: string; shift: string }[]): Promise<ActionResult> {
  const p = z.array(z.object({ employee_id: uuid, work_date: date, shift: z.union([uuid, z.literal("off"), z.literal("default")]) })).max(5000).safeParse(rows);
  if (!p.success) return invalid(p.error);
  return run(M, ["/hr/roster"], async (ctx) => {
    raise((await ctx.supabase.rpc("hr_save_roster", { p_hotel_id: ctx.hotel.id, p_rows: p.data })).error);
    return undefined;
  });
}

// ----------------------------------------------------------------------------- الإجازات
export async function saveLeaveAction(input: unknown): Promise<ActionResult> {
  const p = z.object({ employee_id: uuid, leave_type_id: uuid, start_date: date, end_date: date, reason: text(300), approve: bool }).safeParse(input);
  if (!p.success || p.data.end_date < p.data.start_date) return fail;
  const { approve, ...row } = p.data;
  return run(M, ["/hr"], async (ctx) => {
    raise((await ctx.supabase.from("hr_leaves").insert({ ...row, hotel_id: ctx.hotel.id, status: approve ? "approved" : "pending" })).error);
    return undefined;
  });
}

export async function decideLeaveAction(id: string, status: "approved" | "rejected" | "cancelled"): Promise<ActionResult> {
  if (!uuid.safeParse(id).success || !["approved", "rejected", "cancelled"].includes(status)) return fail;
  return run(M, ["/hr"], async (ctx) => {
    raise((await ctx.supabase.from("hr_leaves").update({ status }).eq("id", id).eq("hotel_id", ctx.hotel.id)).error);
    return undefined;
  });
}

// ----------------------------------------------------------------------------- السلف والجزاءات
export async function payAdvanceAction(input: unknown): Promise<ActionResult<string>> {
  const p = z.object({ employee_id: uuid, advance_date: date, amount: amount(false), installments: num(1, 60), payment_method_id: uuid, notes: text(300) }).safeParse(input);
  if (!p.success) return invalid(p.error);
  return run(M, ["/hr"], async (ctx) => {
    const { data, error } = await ctx.supabase.rpc("hr_pay_advance", {
      p_employee_id: p.data.employee_id, p_date: p.data.advance_date, p_amount: p.data.amount, p_installments: p.data.installments,
      p_payment_method_id: p.data.payment_method_id, p_notes: p.data.notes,
    });
    raise(error);
    return data as string;
  });
}

export async function savePenaltyAction(input: unknown): Promise<ActionResult> {
  const p = z.object({ employee_id: uuid, penalty_date: date, amount: amount(false), reason: z.string().trim().min(2).max(300), approve: bool }).safeParse(input);
  if (!p.success) return invalid(p.error);
  const { approve, ...row } = p.data;
  return run(M, ["/hr"], async (ctx) => {
    raise((await ctx.supabase.from("hr_penalties").insert({ ...row, hotel_id: ctx.hotel.id, status: approve ? "approved" : "pending" })).error);
    return undefined;
  });
}

export async function decidePenaltyAction(id: string, status: "approved" | "cancelled"): Promise<ActionResult> {
  if (!uuid.safeParse(id).success || !["approved", "cancelled"].includes(status)) return fail;
  return run(M, ["/hr"], async (ctx) => {
    raise((await ctx.supabase.from("hr_penalties").update({ status }).eq("id", id).eq("hotel_id", ctx.hotel.id)).error);
    return undefined;
  });
}

// ----------------------------------------------------------------------------- المسيّر ونهاية الخدمة
export async function runPayrollAction(month: string): Promise<ActionResult<string>> {
  if (!/^\d{4}-\d{2}$/.test(month)) return fail;
  return run(M, ["/hr/payroll", "/payroll", "/journal", "/"], async (ctx) => {
    const { data, error } = await ctx.supabase.rpc("hr_run_payroll", { p_hotel_id: ctx.hotel.id, p_month: `${month}-01` });
    raise(error);
    return data as string;
  });
}

export async function settlementQuoteAction(employeeId: string, day: string, reason: string): Promise<ActionResult<SettlementQuote>> {
  const p = z.object({ employeeId: uuid, day: date, reason: z.enum(["resignation", "termination"]) }).safeParse({ employeeId, day, reason });
  if (!p.success) return invalid(p.error);
  const ctx = await requireAppContext(PERMISSIONS.hrView);
  return toActionResult(() => settlementQuote(ctx.supabase, p.data.employeeId, p.data.day, p.data.reason));
}

export async function terminateAction(input: unknown): Promise<ActionResult> {
  const p = z.object({ employee_id: uuid, date, reason: z.enum(["resignation", "termination"]), notes: text(500) }).safeParse(input);
  if (!p.success) return invalid(p.error);
  return run(M, ["/hr", "/journal", "/"], async (ctx) => {
    raise((await ctx.supabase.rpc("hr_terminate", { p_employee_id: p.data.employee_id, p_date: p.data.date, p_reason: p.data.reason, p_notes: p.data.notes })).error);
    return undefined;
  });
}

// ----------------------------------------------------------------------------- الإعدادات
const tiers = z.array(z.object({ from: num(0, 60), days: num(0, 365) })).min(1).max(10);
const resign = z.array(z.object({ from: num(0, 60), pct: num(0, 100) })).min(1).max(10);

export async function saveHrSettingsAction(input: unknown): Promise<ActionResult> {
  const p = z.object({
    work_hours_per_day: num(1, 24), weekend_days: z.array(z.number().int().min(0).max(6)).max(6), month_days: num(28, 31),
    late_grace_minutes: num(0, 240), late_deduction_rate: num(0, 10), absence_deduction_days: num(0, 10), overtime_rate: num(0, 10),
    insurance_employee_pct: num(0, 100), insurance_employer_pct: num(0, 100), eos_tiers: tiers, eos_resign: resign,
    leave_encashment: z.boolean(), expiry_alert_days: num(1, 365),
  }).safeParse(input);
  if (!p.success) return invalid(p.error);
  const sort = <T extends { from: number }>(x: T[]) => [...x].sort((a, b) => a.from - b.from);
  return run(M, ["/settings/hr", "/hr"], async (ctx) => {
    const row = { ...p.data, month_days: Math.round(p.data.month_days), late_grace_minutes: Math.round(p.data.late_grace_minutes), expiry_alert_days: Math.round(p.data.expiry_alert_days),
      eos_tiers: sort(p.data.eos_tiers), eos_resign: sort(p.data.eos_resign) };
    raise((await ctx.supabase.from("hr_settings").update(row as never).eq("hotel_id", ctx.hotel.id)).error);
    return undefined;
  });
}

export async function saveLeaveTypeAction(input: unknown): Promise<ActionResult> {
  const p = z.object({ id: optUuid, name: z.string().trim().min(1).max(60), days_per_year: num(0, 366), paid: bool, carry_over: bool, encashable: bool, is_active: bool }).safeParse(input);
  if (!p.success) return invalid(p.error);
  const { id, ...row } = p.data;
  return run(M, ["/settings/hr", "/hr"], async (ctx) => {
    const r = { ...row, days_per_year: String(row.days_per_year), is_active: id ? row.is_active : true };
    raise((id ? await ctx.supabase.from("hr_leave_types").update(r).eq("id", id).eq("hotel_id", ctx.hotel.id)
      : await ctx.supabase.from("hr_leave_types").insert({ ...r, hotel_id: ctx.hotel.id })).error);
    return undefined;
  });
}

export async function savePayComponentAction(input: unknown): Promise<ActionResult> {
  const p = z.object({
    id: optUuid, name: z.string().trim().min(1).max(60), kind: z.enum(["allowance", "deduction"]), calc: z.enum(["fixed", "percent"]),
    default_value: amount(), insurable: bool, in_eos: bool, is_active: bool,
  }).safeParse(input);
  if (!p.success || (p.data.calc === "percent" && toMoney(p.data.default_value).gt(100))) return fail;
  const { id, ...row } = p.data;
  return run(M, ["/settings/hr", "/hr"], async (ctx) => {
    const r = { ...row, is_active: id ? row.is_active : true };
    raise((id ? await ctx.supabase.from("hr_pay_components").update(r).eq("id", id).eq("hotel_id", ctx.hotel.id)
      : await ctx.supabase.from("hr_pay_components").insert({ ...r, hotel_id: ctx.hotel.id })).error);
    return undefined;
  });
}

export async function saveShiftAction(input: unknown): Promise<ActionResult> {
  const p = z.object({ id: optUuid, name: z.string().trim().min(1).max(40), start_time: time, end_time: time, is_active: bool }).safeParse(input);
  if (!p.success || p.data.start_time === p.data.end_time) return fail;
  const { id, ...row } = p.data;
  return run(M, ["/settings/hr", "/hr"], async (ctx) => {
    const r = { ...row, is_active: id ? row.is_active : true };
    raise((id ? await ctx.supabase.from("hr_shifts").update(r).eq("id", id).eq("hotel_id", ctx.hotel.id)
      : await ctx.supabase.from("hr_shifts").insert({ ...r, hotel_id: ctx.hotel.id })).error);
    return undefined;
  });
}
