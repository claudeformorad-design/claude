import type { Field } from "../_assets/simple-form";
import type { GuestRow } from "@/lib/supabase/database.types";
import { ID_TYPES } from "@/lib/pms/labels";

/** حقول نموذج النزيل (مشتركة بين قائمة النزلاء وملف النزيل) */
export function guestFormFields(companies: { id: string; label: string }[]): Field[] {
  return [
    { name: "full_name", label: "الاسم الكامل" },
    { name: "phone", label: "الجوال", ltr: true },
    { name: "id_type", label: "نوع الهوية", optional: true, options: Object.entries(ID_TYPES).map(([id, label]) => ({ id, label })) },
    { name: "id_number", label: "رقم الهوية", ltr: true },
    { name: "nationality", label: "الجنسية" },
    { name: "date_of_birth", label: "تاريخ الميلاد", type: "date" },
    { name: "email", label: "البريد الإلكتروني", ltr: true },
    ...(companies.length ? [{ name: "customer_id", label: "الشركة / الجهة", optional: true, options: companies } as Field] : []),
    { name: "notes", label: "ملاحظات وتفضيلات" },
    { name: "is_blacklisted", label: "إدراج في القائمة السوداء (يمنع الحجز)", checkbox: true },
    { name: "blacklist_reason", label: "سبب الإدراج" },
  ];
}

export function guestInitial(g: GuestRow | null): Record<string, string | boolean> {
  return {
    ...(g ? { id: g.id } : {}),
    full_name: g?.full_name ?? "", phone: g?.phone ?? "", id_type: g?.id_type ?? "", id_number: g?.id_number ?? "",
    nationality: g?.nationality ?? "", date_of_birth: g?.date_of_birth ?? "", email: g?.email ?? "", customer_id: g?.customer_id ?? "",
    notes: g?.notes ?? "", is_blacklisted: g?.is_blacklisted ?? false, blacklist_reason: g?.blacklist_reason ?? "",
  };
}
