import "server-only";
import { buildAccountTree, flattenAccountTree } from "@/lib/accounting/accounts";
import type { AppContext } from "@/lib/auth/context";
import { listAccounts, listDepartments } from "@/services/accounts.service";
import type { JournalFormProps } from "./journal-form";

/** تجهيز قوائم الحسابات والأقسام والعملات لنموذج القيد */
export async function loadJournalFormData(
  ctx: AppContext,
  locale: string,
): Promise<Pick<JournalFormProps, "accounts" | "departments" | "currencies" | "baseCurrency">> {
  const [accounts, departments, currencies] = await Promise.all([
    listAccounts(ctx.supabase, ctx.hotel.id),
    listDepartments(ctx.supabase, ctx.hotel.id),
    ctx.supabase.from("currencies").select("code").eq("is_active", true).order("code"),
  ]);
  const name = (a: { name_ar: string; name_en: string | null }) => (locale === "en" && a.name_en) || a.name_ar;

  return {
    baseCurrency: ctx.hotel.base_currency,
    currencies: [ctx.hotel.base_currency, ...(currencies.data ?? []).map((c) => c.code).filter((c) => c !== ctx.hotel.base_currency)],
    accounts: flattenAccountTree(buildAccountTree(accounts.filter((a) => a.is_active))).map((a) => ({
      id: a.id,
      label: `${a.code} — ${name(a)}`,
      postable: a.is_postable,
      depth: a.depth,
      departmentId: a.department_id,
    })),
    departments: departments
      .filter((d) => d.is_active)
      .map((d) => ({ id: d.id, label: `${d.code} — ${(locale === "en" && d.name_en) || d.name_ar}` })),
  };
}
