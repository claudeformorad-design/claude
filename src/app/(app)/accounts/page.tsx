import Link from "@/components/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { buildAccountTree, flattenAccountTree } from "@/lib/accounting/accounts";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import type { AccountFormInput } from "@/lib/validation/account";
import { listAccounts, listDepartments } from "@/services/accounts.service";
import { getI18n } from "@/i18n/server";
import { cn } from "@/lib/utils";
import { AccountForm } from "./account-form";
import { HandCoins, Landmark, PieChart, TrendingDown, TrendingUp } from "lucide-react";
import { Stat, StatGrid } from "@/components/ui/stat";

export const metadata = { title: "دليل الحسابات" };

const TYPE_ORDER = ["asset", "liability", "equity", "revenue", "expense"] as const;
const TYPE_COLOR: Record<(typeof TYPE_ORDER)[number], string> = {
  asset: "#008a7c", liability: "#cc6a38", equity: "#3f7fc4", revenue: "#4e9b63", expense: "#b8873a",
};
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
        description={t.accounts.subtitle}
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
      <div className={`grid gap-6 ${formInitial ? "xl:grid-cols-[1fr_380px]" : ""}`}>
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.accounts.code}</TableHead>
                <TableHead>{locale === "ar" ? t.accounts.nameAr : t.accounts.nameEn}</TableHead>
                <TableHead>{t.accounts.type}</TableHead>
                <TableHead>{t.accounts.normalBalance}</TableHead>
                <TableHead>{t.common.status}</TableHead>
                {canManage && <TableHead className="text-end">{t.common.actions}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((a) => (
                <TableRow key={a.id} className={cn(!a.is_postable && "bg-panel font-semibold", a.depth === 0 && "bg-subtle/70", !a.is_active && "opacity-50")}>
                  <TableCell className={cn("num", a.is_postable ? "text-slate-600" : "text-ink")}>{a.code}</TableCell>
                  <TableCell>
                    <span className="flex items-center gap-2.5" style={{ paddingInlineStart: `${a.depth * 1.35}rem` }}>
                      <span className={cn("shrink-0 rounded-full", a.is_postable ? "size-1.5" : "size-2.5")} style={{ background: TYPE_COLOR[a.account_type] }} />
                      {name(a)}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{t.accounts.subtypes[a.account_subtype]}</TableCell>
                  <TableCell>{t.accounts.sides[a.normal_balance]}</TableCell>
                  <TableCell>
                    <Badge variant={a.is_postable ? "secondary" : "outline"}>
                      {a.is_postable ? t.accounts.detail : t.accounts.header}
                    </Badge>
                  </TableCell>
                  {canManage && (
                    <TableCell className="space-x-1 text-end whitespace-nowrap rtl:space-x-reverse">
                      {!a.is_postable && (
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/accounts?new=1&parent=${a.id}`}><Plus /></Link>
                        </Button>
                      )}
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/accounts?edit=${a.id}`}>{t.common.edit}</Link>
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        {formInitial && (
          <Card className="h-fit xl:sticky xl:top-0">
            <CardHeader>
              <CardTitle>{formInitial.id ? t.accounts.editAccount : t.accounts.newAccount}</CardTitle>
            </CardHeader>
            <CardContent>
              <AccountForm
                key={formInitial.id ?? `new-${params.parent ?? ""}`}
                t={{ accounts: t.accounts, common: t.common, errors: t.errors }}
                initial={formInitial}
                accounts={rows.map((a) => ({
                  id: a.id, code: a.code, name: name(a), account_type: a.account_type,
                  is_postable: a.is_postable, parent_id: a.parent_id, depth: a.depth,
                }))}
                departments={departments.map((d) => ({ id: d.id, label: `${d.code} — ${(locale === "en" && d.name_en) || d.name_ar}` }))}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
