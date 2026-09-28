import type { Field } from "../_assets/simple-form";
import type { HrEmployeeRow } from "@/lib/supabase/database.types";
import { CONTRACT_TYPES } from "@/lib/hr/labels";

type Option = { id: string; label: string };

/** نموذج الموظف: البيانات الوظيفية والشخصية والعقد والراتب الأساسي */
export function employeeFields(departments: Option[], shifts: Option[]): Field[] {
  return [
    { name: "full_name", label: "الاسم الكامل" },
    { name: "code", label: "الرمز، ويُولَّد تلقائيًا إن تُرك فارغًا", ltr: true },
    { name: "job_title", label: "المسمى الوظيفي" },
    { name: "department_id", label: "القسم", options: departments },
    { name: "hire_date", label: "تاريخ التعيين", type: "date" },
    { name: "basic_salary", label: "الراتب الأساسي الشهري", type: "number" },
    { name: "contract_type", label: "نوع العقد", options: Object.entries(CONTRACT_TYPES).map(([id, label]) => ({ id, label })) },
    { name: "contract_end", label: "نهاية العقد", type: "date" },
    { name: "shift_id", label: "الوردية الافتراضية", options: shifts, optional: true },
    { name: "phone", label: "الجوال", ltr: true },
    { name: "nationality", label: "الجنسية" },
    { name: "id_number", label: "رقم الهوية أو الإقامة", ltr: true },
    { name: "id_expiry", label: "انتهاء الهوية", type: "date" },
    { name: "birth_date", label: "تاريخ الميلاد", type: "date" },
    { name: "email", label: "البريد الإلكتروني", ltr: true },
    { name: "notes", label: "ملاحظات" },
  ];
}

const who = (employees?: Option[]): Field[] => (employees ? [{ name: "employee_id", label: "الموظف", options: employees }] : []);

export const leaveFields = (types: Option[], employees?: Option[]): Field[] => [
  ...who(employees),
  { name: "leave_type_id", label: "نوع الإجازة", options: types },
  { name: "start_date", label: "من", type: "date" },
  { name: "end_date", label: "إلى", type: "date" },
  { name: "reason", label: "السبب أو الملاحظة" },
  { name: "approve", label: "اعتمادها مباشرة", checkbox: true },
];

export const advanceFields = (methods: Option[], employees?: Option[]): Field[] => [
  ...who(employees),
  { name: "advance_date", label: "تاريخ الصرف", type: "date" },
  { name: "amount", label: "المبلغ", type: "number" },
  { name: "installments", label: "عدد الأقساط الشهرية", type: "number" },
  { name: "payment_method_id", label: "يُصرف من", options: methods },
  { name: "notes", label: "ملاحظات" },
];

export const penaltyFields = (employees?: Option[]): Field[] => [
  ...who(employees),
  { name: "penalty_date", label: "التاريخ", type: "date" },
  { name: "amount", label: "مبلغ الخصم", type: "number" },
  { name: "reason", label: "السبب" },
  { name: "approve", label: "اعتماده مباشرة", checkbox: true },
];

export function employeeInitial(e?: HrEmployeeRow, defaults: { department_id?: string; today?: string } = {}): Record<string, string> {
  return {
    id: e?.id ?? "", full_name: e?.full_name ?? "", code: e?.code ?? "", job_title: e?.job_title ?? "",
    department_id: e?.department_id ?? defaults.department_id ?? "", hire_date: e?.hire_date ?? defaults.today ?? "",
    basic_salary: e ? String(Number(e.basic_salary)) : "", contract_type: e?.contract_type ?? "permanent", contract_end: e?.contract_end ?? "",
    shift_id: e?.shift_id ?? "", phone: e?.phone ?? "", nationality: e?.nationality ?? "", id_number: e?.id_number ?? "",
    id_expiry: e?.id_expiry ?? "", birth_date: e?.birth_date ?? "", email: e?.email ?? "", notes: e?.notes ?? "",
  };
}
