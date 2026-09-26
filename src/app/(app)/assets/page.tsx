import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { toMoney } from "@/lib/accounting/money";
import type { FixedAssetRow } from "@/lib/supabase/database.types";
import { listAccounts, listDepartments } from "@/services/accounts.service";
import { getI18n } from "@/i18n/server";
import { disposeAssetAction, registerAssetAction, runDepreciationAction } from "../_assets/actions";
import { SimpleForm } from "../_assets/simple-form";

export default async function AssetsPage() {
  const ctx = await requireAppContext(PERMISSIONS.assetsView);
  const { locale, t } = await getI18n();
  const [assetsRes, accounts, departments] = await Promise.all([
    ctx.supabase.from("fixed_assets")
      .select("id, hotel_id, asset_number, name, category, asset_account_id, department_id, acquisition_date, cost::text, salvage_value::text, useful_life_months, depreciation_start, accumulated_depreciation::text, status, vendor_bill_id, journal_entry_id, disposal_date, disposal_proceeds::text, disposal_journal_entry_id, notes, created_at, created_by")
      .eq("hotel_id", ctx.hotel.id).order("acquisition_date", { ascending: false }),
    listAccounts(ctx.supabase, ctx.hotel.id),
    listDepartments(ctx.supabase, ctx.hotel.id),
  ]);
  const assets = (assetsRes.data ?? []) as unknown as FixedAssetRow[];
  const name = (x: { name_ar: string; name_en: string | null }) => (locale === "en" && x.name_en) || x.name_ar;
  const opt = (list: typeof accounts) => list.map((a) => ({ id: a.id, label: `${a.code} — ${name(a)}` }));
  const postable = accounts.filter((a) => a.is_postable && a.is_active);
  const assetAccounts = opt(postable.filter((a) => a.account_subtype === "fixed_asset" && a.system_key !== "accumulated_depreciation"));
  const funding = opt(postable.filter((a) => ["asset", "liability", "equity"].includes(a.account_type) && a.account_subtype !== "fixed_asset"
    && !["guest_ledger", "ar_control", "guest_deposits", "ap_control"].includes(a.system_key ?? "")));
  const cash = opt(postable.filter((a) => a.account_type === "asset" && a.account_subtype === "current_asset"));
  const depts = departments.map((d) => ({ id: d.id, label: `${d.code} — ${name(d)}` }));
  const can = ctx.can(PERMISSIONS.assetsManage);
  const today = todayInTimeZone(ctx.hotel.timezone);
  const a = t.assets;

  return (
    <>
      <PageHeader title={t.nav.fixedAssets} description={a.subtitle} />
      {can && (
        <div className="mb-6 grid gap-6 xl:grid-cols-[2fr_1fr]">
          <Card><CardHeader><CardTitle>{a.register}</CardTitle></CardHeader><CardContent>
            <SimpleForm columns={4} submitLabel={a.register} errors={t.errors} action={registerAssetAction}
              initial={{ name: "", category: "", asset_account_id: "", cost: "", salvage_value: "0", useful_life_months: "60", acquisition_date: today, department_id: "", counter_account_id: "", notes: "" }}
              fields={[
                { name: "name", label: a.name }, { name: "category", label: a.category },
                { name: "asset_account_id", label: a.account, options: assetAccounts }, { name: "department_id", label: t.folio.department, options: depts, optional: true },
                { name: "cost", label: a.cost, type: "number" }, { name: "salvage_value", label: a.salvage, type: "number" },
                { name: "useful_life_months", label: a.life, type: "number" }, { name: "acquisition_date", label: a.acquired, type: "date" },
                { name: "counter_account_id", label: a.funding, options: funding },
              ]} />
          </CardContent></Card>
          <Card><CardHeader><CardTitle>{a.runDepreciation}</CardTitle></CardHeader><CardContent>
            <SimpleForm columns={1} submitLabel={a.runDepreciation} errors={t.errors}
              action={async (v) => { "use server"; return runDepreciationAction(String(v.month)); }}
              initial={{ month: today.slice(0, 7) }} fields={[{ name: "month", label: t.payables.month, type: "month" }]} />
          </CardContent></Card>
        </div>
      )}
      <Card className="overflow-hidden">
        <Table>
          <TableHeader><TableRow>
            <TableHead>{a.number}</TableHead><TableHead>{a.name}</TableHead><TableHead>{a.acquired}</TableHead>
            <TableHead className="text-end">{a.cost}</TableHead><TableHead className="text-end">{a.accumulated}</TableHead>
            <TableHead className="text-end">{a.nbv}</TableHead><TableHead>{t.common.status}</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {assets.length === 0 && <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">{t.common.noData}</TableCell></TableRow>}
            {assets.map((x) => (
              <TableRow key={x.id}>
                <TableCell className="num">{x.asset_number}</TableCell>
                <TableCell>
                  <p>{x.name} <span className="text-xs text-muted-foreground">· {x.category} · {x.useful_life_months}</span></p>
                  {can && x.status !== "disposed" && (
                    <details className="mt-1 text-sm"><summary className="cursor-pointer text-primary">{a.dispose}</summary>
                      <div className="mt-2">
                        <SimpleForm columns={4} submitLabel={a.dispose} errors={t.errors}
                          action={async (v) => { "use server"; return disposeAssetAction({ ...v, asset_id: x.id }); }}
                          initial={{ disposal_date: today, proceeds: "0", proceeds_account_id: "" }}
                          fields={[{ name: "disposal_date", label: t.common.date, type: "date" }, { name: "proceeds", label: a.proceeds, type: "number" },
                            { name: "proceeds_account_id", label: a.proceedsAccount, options: cash, optional: true }]} />
                      </div>
                    </details>
                  )}
                </TableCell>
                <TableCell className="num">{x.acquisition_date}</TableCell>
                <TableCell className="text-end"><Money value={x.cost} locale={locale} /></TableCell>
                <TableCell className="text-end"><Money value={x.accumulated_depreciation} locale={locale} blankZero /></TableCell>
                <TableCell className="text-end"><Money value={x.status === "disposed" ? "0" : toMoney(x.cost).minus(toMoney(x.accumulated_depreciation))} locale={locale} /></TableCell>
                <TableCell><Badge variant={x.status === "active" ? "success" : "secondary"}>{a.statuses[x.status]}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
