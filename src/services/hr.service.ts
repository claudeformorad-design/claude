import { tr } from "@/i18n/tr";
import "server-only";
import type { SupabaseServerClient } from "@/lib/supabase/server";
import type {
  HrAdvanceRow, HrAttendanceRow, HrEmployeeRow, HrLeaveRow, HrLeaveTypeRow, HrPayComponentRow, HrPenaltyRow, HrRosterRow,
  HrSettingsRow, HrSettlementRow, HrShiftRow,
} from "@/lib/supabase/database.types";
import { raise } from "./errors";

/**
 * قراءة بيانات الموارد البشرية. الحساب المالي (المسيّر، المكافأة، الرصيد) في قاعدة البيانات،
 * وهنا الجلب والتجميع للعرض فقط. كل شيء تحت صلاحيات المستخدم (RLS).
 */
export type EmployeeListItem = HrEmployeeRow & { department: { code: string; name_ar: string } | null; shift: { name: string } | null };
export type LeaveListItem = HrLeaveRow & { employee: { full_name: string; code: string } | null; leave_type: { name: string; paid: boolean } | null };
export type AdvanceListItem = HrAdvanceRow & { employee: { full_name: string; code: string } | null };
export type PenaltyListItem = HrPenaltyRow & { employee: { full_name: string; code: string } | null };
export type LeaveBalance = {
  leave_type_id: string; name: string; paid: boolean; limited: boolean;
  entitlement: number; carried: number; taken: number; pending: number; remaining: number;
};
export type PayrollLine = {
  employee_id: string; employee_name: string; employee_code: string; department_id: string;
  basic: number; allowances: number; overtime: number; deductions: number; insurance_employee: number; insurance_employer: number; advance_recovery: number;
  details: {
    days: number; month_days: number; allowances: { name: string; amount: number }[]; overtime_minutes: number; absent_days: number; absence: number;
    late_minutes: number; late: number; unpaid_leave_days: number; unpaid_leave: number; penalties: number; component_deductions: number;
    advances: { id: string; amount: number }[];
  };
};
export type SettlementQuote = {
  years: number; wage: number; full: number; pct: number; amount: number; reason: string; date: string; leave_days: number; daily: number;
  leave_amount: number; advances_open: number; advances_recovered: number; net: number; advances_left: number;
};

const EMP_EMBED = "*, department:departments(code, name_ar, name_en), shift:hr_shifts(name)";
const WHO = "employee:hr_employees(full_name, code)";

export async function getHrSettings(supabase: SupabaseServerClient, hotelId: string): Promise<HrSettingsRow> {
  const { data, error } = await supabase.from("hr_settings").select("*").eq("hotel_id", hotelId).single();
  raise(error);
  return data as HrSettingsRow;
}

/** أسماء البنود الافتراضية المزروعة بالعربية تظهر مترجمة في الواجهة الإنجليزية؛ ما يكتبه المستخدم يبقى كما هو */
const seedName = <T extends { name: string }>(r: T): T => ({ ...r, name: tr(r.name) });
const leaveTypeName = <T extends { leave_type: { name: string } | null }>(l: T): T => (l.leave_type ? { ...l, leave_type: { ...l.leave_type, name: tr(l.leave_type.name) } } : l);

export async function listLeaveTypes(supabase: SupabaseServerClient, hotelId: string): Promise<HrLeaveTypeRow[]> {
  const { data, error } = await supabase.from("hr_leave_types").select("*").eq("hotel_id", hotelId).order("sort_order").order("name");
  raise(error);
  return ((data ?? []) as HrLeaveTypeRow[]).map(seedName);
}

export async function listPayComponents(supabase: SupabaseServerClient, hotelId: string): Promise<HrPayComponentRow[]> {
  const { data, error } = await supabase.from("hr_pay_components").select("*").eq("hotel_id", hotelId).order("kind").order("sort_order").order("name");
  raise(error);
  return ((data ?? []) as HrPayComponentRow[]).map(seedName);
}

export async function listShifts(supabase: SupabaseServerClient, hotelId: string): Promise<HrShiftRow[]> {
  const { data, error } = await supabase.from("hr_shifts").select("*").eq("hotel_id", hotelId).order("start_time");
  raise(error);
  return ((data ?? []) as HrShiftRow[]).map(seedName);
}

export async function listEmployees(supabase: SupabaseServerClient, hotelId: string, opts: { includeTerminated?: boolean } = {}): Promise<EmployeeListItem[]> {
  let q = supabase.from("hr_employees").select(EMP_EMBED).eq("hotel_id", hotelId);
  if (!opts.includeTerminated) q = q.eq("status", "active");
  const { data, error } = await q.order("code");
  raise(error);
  return (data ?? []) as unknown as EmployeeListItem[];
}

export async function getEmployee(supabase: SupabaseServerClient, hotelId: string, id: string) {
  const { data, error } = await supabase.from("hr_employees").select(EMP_EMBED).eq("hotel_id", hotelId).eq("id", id).maybeSingle();
  raise(error);
  if (!data) return null;
  const year = new Date().getFullYear();
  const [components, overrides, balances, leaves, advances, penalties, settlement] = await Promise.all([
    listPayComponents(supabase, hotelId),
    supabase.from("hr_employee_components").select("component_id, value::text").eq("employee_id", id),
    supabase.rpc("hr_leave_balances", { p_employee_id: id, p_year: year }),
    supabase.from("hr_leaves").select(`*, leave_type:hr_leave_types(name, paid)`).eq("employee_id", id).order("start_date", { ascending: false }).limit(20),
    supabase.from("hr_advances").select("*").eq("employee_id", id).order("advance_date", { ascending: false }),
    supabase.from("hr_penalties").select("*").eq("employee_id", id).order("penalty_date", { ascending: false }).limit(20),
    supabase.from("hr_settlements").select("*").eq("employee_id", id).maybeSingle(),
  ]);
  for (const r of [overrides, balances, leaves, advances, penalties, settlement]) raise(r.error);
  const value = new Map((overrides.data ?? []).map((o) => [o.component_id as string, o.value as string]));
  return {
    employee: data as unknown as EmployeeListItem,
    components: components.filter((c) => c.is_active).map((c) => ({ ...c, override: value.get(c.id) ?? null })),
    balances: (balances.data ?? []) as LeaveBalance[],
    leaves: ((leaves.data ?? []) as unknown as LeaveListItem[]).map(leaveTypeName),
    advances: (advances.data ?? []) as HrAdvanceRow[],
    penalties: (penalties.data ?? []) as HrPenaltyRow[],
    settlement: (settlement.data as HrSettlementRow | null) ?? null,
  };
}

export async function attendanceOn(supabase: SupabaseServerClient, hotelId: string, date: string) {
  const [att, leaves, roster] = await Promise.all([
    supabase.from("hr_attendance").select("*").eq("hotel_id", hotelId).eq("work_date", date),
    supabase.from("hr_leaves").select("employee_id, leave_type:hr_leave_types(name)").eq("hotel_id", hotelId).eq("status", "approved")
      .lte("start_date", date).gte("end_date", date),
    supabase.from("hr_roster").select("employee_id, shift_id").eq("hotel_id", hotelId).eq("work_date", date),
  ]);
  for (const r of [att, leaves, roster]) raise(r.error);
  return {
    attendance: (att.data ?? []) as HrAttendanceRow[],
    onLeave: new Map(((leaves.data ?? []) as unknown as { employee_id: string; leave_type: { name: string } | null }[]).map((l) => [l.employee_id, l.leave_type?.name ? tr(l.leave_type.name) : tr("إجازة")])),
    roster: new Map(((roster.data ?? []) as HrRosterRow[]).map((r) => [r.employee_id, r.shift_id])),
  };
}

export async function rosterBetween(supabase: SupabaseServerClient, hotelId: string, from: string, to: string): Promise<HrRosterRow[]> {
  const { data, error } = await supabase.from("hr_roster").select("*").eq("hotel_id", hotelId).gte("work_date", from).lte("work_date", to);
  raise(error);
  return (data ?? []) as HrRosterRow[];
}

export async function listLeaves(supabase: SupabaseServerClient, hotelId: string, status?: HrLeaveRow["status"]): Promise<LeaveListItem[]> {
  let q = supabase.from("hr_leaves").select(`*, ${WHO}, leave_type:hr_leave_types(name, paid)`).eq("hotel_id", hotelId);
  if (status) q = q.eq("status", status);
  const { data, error } = await q.order("start_date", { ascending: false }).limit(300);
  raise(error);
  return ((data ?? []) as unknown as LeaveListItem[]).map(leaveTypeName);
}

export async function listAdvances(supabase: SupabaseServerClient, hotelId: string): Promise<AdvanceListItem[]> {
  const { data, error } = await supabase.from("hr_advances").select(`*, ${WHO}`).eq("hotel_id", hotelId).order("advance_date", { ascending: false }).limit(300);
  raise(error);
  return (data ?? []) as unknown as AdvanceListItem[];
}

export async function listPenalties(supabase: SupabaseServerClient, hotelId: string): Promise<PenaltyListItem[]> {
  const { data, error } = await supabase.from("hr_penalties").select(`*, ${WHO}`).eq("hotel_id", hotelId).order("penalty_date", { ascending: false }).limit(300);
  raise(error);
  return (data ?? []) as unknown as PenaltyListItem[];
}

export async function payrollPreview(supabase: SupabaseServerClient, hotelId: string, month: string): Promise<PayrollLine[]> {
  const { data, error } = await supabase.rpc("hr_payroll_preview", { p_hotel_id: hotelId, p_month: month });
  raise(error);
  return ((data ?? []) as PayrollLine[]).map((l) => ({
    ...l,
    basic: Number(l.basic), allowances: Number(l.allowances), overtime: Number(l.overtime), deductions: Number(l.deductions),
    insurance_employee: Number(l.insurance_employee), insurance_employer: Number(l.insurance_employer), advance_recovery: Number(l.advance_recovery),
  }));
}

export async function settlementQuote(supabase: SupabaseServerClient, employeeId: string, date: string, reason: string): Promise<SettlementQuote> {
  const { data, error } = await supabase.rpc("hr_settlement_quote", { p_employee_id: employeeId, p_date: date, p_reason: reason });
  raise(error);
  return data as SettlementQuote;
}

/** تنبيهات: هويات وعقود تنتهي خلال المدة المحددة في الإعدادات، أو انتهت */
export function expiryAlerts(employees: HrEmployeeRow[], today: string, days: number) {
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + days);
  const until = limit.toISOString().slice(0, 10);
  const out: { employee: HrEmployeeRow; kind: "id" | "contract"; date: string; expired: boolean }[] = [];
  for (const e of employees) {
    if (e.status !== "active") continue;
    if (e.id_expiry && e.id_expiry <= until) out.push({ employee: e, kind: "id", date: e.id_expiry, expired: e.id_expiry < today });
    if (e.contract_end && e.contract_end <= until) out.push({ employee: e, kind: "contract", date: e.contract_end, expired: e.contract_end < today });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
