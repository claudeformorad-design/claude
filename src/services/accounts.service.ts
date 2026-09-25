import "server-only";
import type { SupabaseServerClient } from "@/lib/supabase/server";
import type { AccountRow, DepartmentRow } from "@/lib/supabase/database.types";
import type { AccountFormValues } from "@/lib/validation/account";
import { raise } from "./errors";

export type AccountListItem = Pick<
  AccountRow,
  | "id" | "code" | "name_ar" | "name_en" | "account_type" | "account_subtype" | "normal_balance"
  | "parent_id" | "level" | "is_postable" | "department_id" | "currency_code" | "system_key"
  | "is_active" | "description"
>;

const ACCOUNT_COLUMNS =
  "id, code, name_ar, name_en, account_type, account_subtype, normal_balance, parent_id, level, is_postable, department_id, currency_code, system_key, is_active, description";

export async function listAccounts(supabase: SupabaseServerClient, hotelId: string): Promise<AccountListItem[]> {
  const { data, error } = await supabase
    .from("chart_of_accounts")
    .select(ACCOUNT_COLUMNS)
    .eq("hotel_id", hotelId)
    .order("code");
  raise(error);
  return (data ?? []) as AccountListItem[];
}

export async function listDepartments(
  supabase: SupabaseServerClient,
  hotelId: string,
): Promise<Pick<DepartmentRow, "id" | "code" | "name_ar" | "name_en" | "kind" | "is_active">[]> {
  const { data, error } = await supabase
    .from("departments")
    .select("id, code, name_ar, name_en, kind, is_active")
    .eq("hotel_id", hotelId)
    .order("code");
  raise(error);
  return data ?? [];
}

/** إنشاء أو تعديل حساب. قواعد الشجرة تفرضها قاعدة البيانات (التريغرات) */
export async function saveAccount(
  supabase: SupabaseServerClient,
  hotelId: string,
  values: AccountFormValues,
): Promise<string> {
  const payload = {
    code: values.code,
    name_ar: values.name_ar,
    name_en: values.name_en,
    account_type: values.account_type,
    account_subtype: values.account_subtype as AccountRow["account_subtype"],
    parent_id: values.parent_id,
    department_id: values.department_id,
    is_postable: values.is_postable,
    is_active: values.is_active,
    description: values.description,
  };

  if (values.id) {
    const { error } = await supabase
      .from("chart_of_accounts")
      .update(payload)
      .eq("id", values.id)
      .eq("hotel_id", hotelId);
    raise(error);
    return values.id;
  }

  const { data, error } = await supabase
    .from("chart_of_accounts")
    .insert({ ...payload, hotel_id: hotelId })
    .select("id")
    .single();
  raise(error);
  return data!.id;
}
