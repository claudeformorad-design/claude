import Link from "@/components/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toMoney } from "@/lib/accounting/money";
import { listAccounts, listDepartments } from "@/services/accounts.service";
import { listChargeCodes, listPaymentMethods, listTaxRates } from "@/services/revenue-settings.service";
import { getI18n } from "@/i18n/server";
import type { RevenueSettingKind } from "./actions";
import { RevenueSettingForm } from "./settings-form";

export default async function RevenueSettingsPage({ searchParams }: { searchParams: Promise<{ edit?: string; new?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.accountsView);
  const { locale, t } = await getI18n();
  const sp = await searchParams;
  const [taxes, codes, methods, accounts, departments] = await Promise.all([
    listTaxRates(ctx.supabase, ctx.hotel.id),
    listChargeCodes(ctx.supabase, ctx.hotel.id),
    listPaymentMethods(ctx.supabase, ctx.hotel.id),
    listAccounts(ctx.supabase, ctx.hotel.id),
    listDepartments(ctx.supabase, ctx.hotel.id),
  ]);
  const canManage = ctx.can(PERMISSIONS.revenueSettingsManage);
  const rs = t.revenueSettings;
  const name = (x: { name_ar: string; name_en: string | null }) => (locale === "en" && x.name_en) || x.name_ar;
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const acc = (id: string) => { const a = accountById.get(id); return a ? `${a.code} — ${name(a)}` : "—"; };
  const taxById = new Map(taxes.map((x) => [x.id, x]));

  // تحديد النموذج المفتوح: ?new=tax أو ?edit=charge:<id>
  let formKind: RevenueSettingKind | null = null;
  let initial: Record<string, unknown> | null = null;
  const [editKind, editId] = (sp.edit ?? "").split(":");
  if (canManage && (sp.new === "tax" || editKind === "tax")) {
    formKind = "tax";
    const x = taxes.find((v) => v.id === editId);
    initial = x ? { ...x, name_en: x.name_en ?? "", rate: toMoney(x.rate).toString() } : { code: "", name_ar: "", name_en: "", kind: "vat", rate: "", is_compound: false, account_id: "", is_active: true };
  } else if (canManage && (sp.new === "charge" || editKind === "charge")) {
    formKind = "charge";
    const x = codes.find((v) => v.id === editId);
    initial = x
      ? { ...x, name_en: x.name_en ?? "", default_price: x.default_price ? toMoney(x.default_price).toString() : "" }
      : { code: "", name_ar: "", name_en: "", category: "other", department_id: "", revenue_account_id: "", default_price: "", price_includes_tax: false, tax_rate_ids: [], is_active: true };
  } else if (canManage && (sp.new === "method" || editKind === "method")) {
    formKind = "method";
    const x = methods.find((v) => v.id === editId);
    initial = x ? { ...x, name_en: x.name_en ?? "" } : { code: "", name_ar: "", name_en: "", kind: "cash", account_id: "", is_active: true };
  }
  const accountOptions = (types: string[]) =>
    accounts.filter((a) => a.is_postable && a.is_active && types.includes(a.account_type)).map((a) => ({ id: a.id, label: `${a.code} — ${name(a)}` }));

  const section = (title: string, kind: RevenueSettingKind, head: string[], rows: React.ReactNode) => (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{title}</CardTitle>
        {canManage && <Button asChild size="sm" variant="outline"><Link href={`/settings/revenue?new=${kind}`}><Plus />{rs.add}</Link></Button>}
      </CardHeader>
      <Table>
        <TableHeader><TableRow>{head.map((h) => <TableHead key={h}>{h}</TableHead>)}{canManage && <TableHead />}</TableRow></TableHeader>
        <TableBody>{rows}</TableBody>
      </Table>
    </Card>
  );
  const editCell = (kind: RevenueSettingKind, id: string) =>
    canManage && <TableCell className="text-end"><Button asChild variant="ghost" size="sm"><Link href={`/settings/revenue?edit=${kind}:${id}`}>{t.common.edit}</Link></Button></TableCell>;
  const active = (v: boolean) => <Badge variant={v ? "success" : "secondary"}>{v ? t.common.active : t.common.inactive}</Badge>;

  return (
    <>
      <PageHeader title={rs.title} description={rs.subtitle} />
      <div className={`grid gap-6 ${formKind && initial ? "xl:grid-cols-[1fr_380px]" : ""}`}>
        <div className="space-y-6">
          {section(rs.taxes, "tax", [t.customers.code, t.customers.name, rs.kind, rs.rate, rs.account, t.common.status],
            taxes.map((x) => (
              <TableRow key={x.id}>
                <TableCell className="num">{x.code}</TableCell><TableCell>{name(x)}</TableCell>
                <TableCell>{rs.taxKinds[x.kind]}{x.is_compound ? " *" : ""}</TableCell>
                <TableCell className="num">{toMoney(x.rate).toString()}%</TableCell>
                <TableCell>{acc(x.account_id)}</TableCell><TableCell>{active(x.is_active)}</TableCell>{editCell("tax", x.id)}
              </TableRow>
            )))}
          {section(rs.chargeCodes, "charge", [t.customers.code, t.customers.name, rs.category, rs.department, rs.revenueAccount, rs.appliedTaxes],
            codes.map((x) => (
              <TableRow key={x.id} className={x.is_active ? "" : "opacity-50"}>
                <TableCell className="num">{x.code}</TableCell><TableCell>{name(x)}</TableCell>
                <TableCell>{rs.categories[x.category]}</TableCell>
                <TableCell>{departments.find((d) => d.id === x.department_id)?.code}</TableCell>
                <TableCell>{acc(x.revenue_account_id)}</TableCell>
                <TableCell>{x.tax_rate_ids.map((id) => taxById.get(id)?.code).join(" + ") || "—"}{x.price_includes_tax ? ` (${t.folio.priceIncludesTax})` : ""}</TableCell>
                {editCell("charge", x.id)}
              </TableRow>
            )))}
          {section(rs.paymentMethods, "method", [t.customers.code, t.customers.name, rs.kind, rs.account, t.common.status],
            methods.map((x) => (
              <TableRow key={x.id}>
                <TableCell className="num">{x.code}</TableCell><TableCell>{name(x)}</TableCell>
                <TableCell>{rs.methodKinds[x.kind]}</TableCell><TableCell>{acc(x.account_id)}</TableCell>
                <TableCell>{active(x.is_active)}</TableCell>{editCell("method", x.id)}
              </TableRow>
            )))}
        </div>
        {formKind && initial && (
          <Card className="h-fit xl:sticky xl:top-0">
            <CardHeader><CardTitle>{formKind === "tax" ? rs.taxes : formKind === "charge" ? rs.chargeCodes : rs.paymentMethods}</CardTitle></CardHeader>
            <CardContent>
              <RevenueSettingForm
                key={sp.edit ?? sp.new}
                t={{ revenueSettings: rs, common: t.common, errors: t.errors, customers: t.customers, folio: t.folio }}
                kind={formKind}
                initial={initial}
                accounts={accountOptions(formKind === "tax" ? ["liability"] : formKind === "charge" ? ["revenue"] : ["asset"])}
                departments={departments.map((d) => ({ id: d.id, label: `${d.code} — ${name(d)}` }))}
                taxes={taxes.filter((x) => x.is_active).map((x) => ({ id: x.id, label: `${x.code} (${toMoney(x.rate).toString()}%)` }))}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
