import { tr } from "@/i18n/tr";
import type { Field } from "../_assets/simple-form";
import type { HrEmployeeRow } from "@/lib/supabase/database.types";
import { CONTRACT_TYPES } from "@/lib/hr/labels";

type Option = { id: string; label: string };

/** نموذج الموظف: البيانات الوظيفية والشخصية والعقد والراتب الأساسي */
export function employeeFields(departments: Option[], shifts: Option[]): Field[] {
  return [
    { name: "full_name", label: tr("الاسم الكامل") },
    { name: "code", label: tr("الرمز، ويُولَّد تلقائيًا إن تُرك فارغًا"), ltr: true },
    { name: "job_title", label: tr("المسمى الوظيفي") },
    { name: "department_id", label: tr("القسم"), options: departments },
    { name: "hire_date", label: tr("تاريخ التعيين"), type: "date" },
    { name: "basic_salary", label: tr("الراتب الأساسي الشهري"), type: "number" },
    { name: "contract_type", label: tr("نوع العقد"), options: Object.entries(CONTRACT_TYPES).map(([id, label]) => ({ id, label })) },
    { name: "contract_end", label: tr("نهاية العقد"), type: "date" },
    { name: "shift_id", label: tr("الوردية الافتراضية"), options: shifts, optional: true },
    { name: "phone", label: tr("الجوال"), ltr: true },
    { name: "nationality", label: tr("الجنسية") },
    { name: "id_number", label: tr("رقم الهوية أو الإقامة"), ltr: true },
    { name: "id_expiry", label: tr("انتهاء الهوية"), type: "date" },
    { name: "birth_date", label: tr("تاريخ الميلاد"), type: "date" },
    { name: "email", label: tr("البريد الإلكتروني"), ltr: true },
    { name: "notes", label: tr("ملاحظات") },
  ];
}

const who = (employees?: Option[]): Field[] => (employees ? [{ name: "employee_id", label: tr("الموظف"), options: employees }] : []);

export const leaveFields = (types: Option[], employees?: Option[]): Field[] => [
  ...who(employees),
  { name: "leave_type_id", label: tr("نوع الإجازة"), options: types },
  { name: "start_date", label: tr("من"), type: "date" },
  { name: "end_date", label: tr("إلى"), type: "date" },
  { name: "reason", label: tr("السبب أو الملاحظة") },
  { name: "approve", label: tr("اعتمادها مباشرة"), checkbox: true },
];

export const advanceFields = (methods: Option[], employees?: Option[]): Field[] => [
  ...who(employees),
  { name: "advance_date", label: tr("تاريخ الصرف"), type: "date" },
  { name: "amount", label: tr("المبلغ"), type: "number" },
  { name: "installments", label: tr("عدد الأقساط الشهرية"), type: "number" },
  { name: "payment_method_id", label: tr("يُصرف من"), options: methods },
  { name: "notes", label: tr("ملاحظات") },
];

export const penaltyFields = (employees?: Option[]): Field[] => [
  ...who(employees),
  { name: "penalty_date", label: tr("التاريخ"), type: "date" },
  { name: "amount", label: tr("مبلغ الخصم"), type: "number" },
  { name: "reason", label: tr("السبب") },
  { name: "approve", label: tr("اعتماده مباشرة"), checkbox: true },
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
