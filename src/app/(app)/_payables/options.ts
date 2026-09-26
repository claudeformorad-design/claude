import "server-only";
import type { AppContext } from "@/lib/auth/context";
import { listAccounts, listDepartments } from "@/services/accounts.service";
import { listTaxRates } from "@/services/revenue-settings.service";
import { listVendors } from "@/services/payables.service";
import { toMoney } from "@/lib/accounting/money";

/** قوائم الاختيار المشتركة لشاشات المشتريات */
export async function loadPurchaseOptions(ctx: AppContext, locale: string) {
  const [accounts, departments, taxes, vendors] = await Promise.all([
    listAccounts(ctx.supabase, ctx.hotel.id),
    listDepartments(ctx.supabase, ctx.hotel.id),
    listTaxRates(ctx.supabase, ctx.hotel.id),
    listVendors(ctx.supabase, ctx.hotel.id),
  ]);
  const name = (x: { name_ar: string; name_en: string | null }) => (locale === "en" && x.name_en) || x.name_ar;
  return {
    accounts: accounts.filter((a) => a.is_postable && a.is_active && (a.account_type === "expense" || a.account_type === "asset"))
      .map((a) => ({ id: a.id, label: `${a.code} — ${name(a)}` })),
    departments: departments.filter((d) => d.is_active).map((d) => ({ id: d.id, label: `${d.code} — ${name(d)}` })),
    taxes: taxes.filter((t) => t.is_active).map((t) => ({ id: t.id, label: `${t.code} ${toMoney(t.rate).toString()}%`, rate: t.rate })),
    vendors: vendors.filter((v) => v.is_active).map((v) => ({ id: v.id, label: `${v.code} — ${name(v)}` })),
    vendorName: new Map(vendors.map((v) => [v.id, name(v)])),
  };
}
