import { RouteDialog } from "@/components/ui/dialog";
import Link from "@/components/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { buildAccountTree, flattenAccountTree } from "@/lib/accounting/accounts";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import type { AccountFormInput } from "@/lib/validation/account";
import { listAccounts, listDepartments } from "@/services/accounts.service";
import { getI18n } from "@/i18n/server";
import { AccountForm } from "./account-form";
import { HandCoins, Landmark, PieChart, TrendingDown, TrendingUp } from "lucide-react";
import { Stat, StatGrid } from "@/components/ui/stat";
import { cookies } from "next/headers";
import { AccountsTree } from "./accounts-tree";

export const metadata = { title: "دليل الحسابات" };

const TYPE_ORDER = ["asset", "liability", "equity", "revenue", "expense"] as const;
const TYPE_ICON = { asset: Landmark, liability: HandCoins, equity: PieChart, revenue: TrendingUp, expense: TrendingDown } as const;

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; new?: string; parent?: string }>;
}) {
  const ctx = await requireAppContext(PERMISSIONS.accountsView);
  const { locale, t } = await getI18n();
  const params = await searchParams;
  const [accounts, departments] = await Promise.all([
    listAccounts(ctx.supabase, ctx.hotel.id),
    listDepartments(ctx.supabase, ctx.hotel.id),
  ]);
  const rows = flattenAccountTree(buildAccountTree(accounts));
  const name = (a: { name_ar: string; name_en: string | null }) => (locale === "en" && a.name_en) || a.name_ar;
  const canManage = ctx.can(PERMISSIONS.accountsManage);
  const density = (await cookies()).get("table_density")?.value === "compact" ? "compact" : "comfortable";

  // نموذج الإنشاء/التعديل
  let formInitial: AccountFormInput | null = null;
  if (canManage && params.edit) {
    const a = accounts.find((x) => x.id === params.edit);
    if (a) {
      formInitial = {
        id: a.id, code: a.code, name_ar: a.name_ar, name_en: a.name_en ?? "", account_type: a.account_type,
        account_subtype: a.account_subtype, parent_id: a.parent_id ?? "", department_id: a.department_id ?? "",
        is_postable: a.is_postable, is_active: a.is_active, description: a.description ?? "",
      };
    }
  } else if (canManage && params.new) {
    const parent = accounts.find((x) => x.id === params.parent);
    formInitial = {
      code: "", name_ar: "", name_en: "", account_type: parent?.account_type ?? "asset",
      account_subtype: parent?.account_subtype ?? "current_asset", parent_id: parent?.id ?? "", department_id: "",
      is_postable: true, is_active: true, description: "",
    };
  }

  return (
    <>
      <PageHeader
        title={t.accounts.title}
        actions={
          canManage && (
            <Button asChild>
              <Link href="/accounts?new=1"><Plus />{t.accounts.newAccount}</Link>
            </Button>
          )
        }
      />
      <StatGrid className="lg:grid-cols-5">
        {TYPE_ORDER.map((ty) => (
          <Stat key={ty} icon={TYPE_ICON[ty]} tone={ty === "asset" ? "ink" : ty === "revenue" ? "teal" : ty === "expense" ? "clay" : "neutral"}
            label={t.accounts.types[ty]} value={<span className="num">{accounts.filter((x) => x.account_type === ty && x.is_postable).length}</span>} hint="حساب تفصيلي" />
        ))}
      </StatGrid>
      <div className="grid gap-6">
        <div className="min-w-0">
          <AccountsTree
            canManage={canManage}
            density={density}
            rows={rows.map((a) => ({
              id: a.id, code: a.code, name: name(a), depth: a.depth, parentId: a.parent_id, isPostable: a.is_postable, isActive: a.is_active,
              typeLabel: t.accounts.types[a.account_type], sideLabel: t.accounts.sides[a.normal_balance],
            }))}
            labels={{
              code: t.accounts.code, name: locale === "ar" ? t.accounts.nameAr : t.accounts.nameEn, type: t.accounts.type,
              side: t.accounts.normalBalance, status: t.common.status, actions: t.common.actions,
              header: t.accounts.header, detail: t.accounts.detail, edit: t.common.edit,
            }}
          />
        </div>

        {formInitial && (
          <RouteDialog closeHref="/accounts" title={formInitial.id ? t.accounts.editAccount : t.accounts.newAccount}>
            <AccountForm
              key={formInitial.id ?? `new-${params.parent ?? ""}`}
              t={{ accounts: t.accounts, common: t.common, errors: t.errors }}
              initial={formInitial}
              accounts={rows.map((a) => ({
                id: a.id, code: a.code, name: name(a), account_type: a.account_type,
                is_postable: a.is_postable, parent_id: a.parent_id, depth: a.depth,
              }))}
              departments={departments.map((d) => ({ id: d.id, label: `${d.code} ${(locale === "en" && d.name_en) || d.name_ar}` }))}
            />
          </RouteDialog>
        )}
      </div>
    </>
  );
}
