import Link from "@/components/link";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { toMoney } from "@/lib/accounting/money";
import type { InventoryItemRow } from "@/lib/supabase/database.types";
import { listAccounts, listDepartments } from "@/services/accounts.service";
import { getI18n } from "@/i18n/server";
import { inventoryMovementAction, saveItemAction } from "../_assets/actions";
import { SimpleForm } from "../_assets/simple-form";

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ edit?: string; new?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.inventoryView);
  const { locale, t } = await getI18n();
  const sp = await searchParams;
  const [itemsRes, accounts, departments, bills] = await Promise.all([
    ctx.supabase.from("inventory_items")
      .select("id, hotel_id, sku, name_ar, name_en, unit, inventory_account_id, expense_account_id, reorder_level::text, quantity_on_hand::text, average_cost::text, is_active, created_at, created_by, updated_at, updated_by")
      .eq("hotel_id", ctx.hotel.id).order("sku"),
    listAccounts(ctx.supabase, ctx.hotel.id),
    listDepartments(ctx.supabase, ctx.hotel.id),
    ctx.supabase.from("vendor_bills").select("id, bill_number, vendor_invoice_no").eq("hotel_id", ctx.hotel.id).order("bill_date", { ascending: false }).limit(50),
  ]);
  const items = (itemsRes.data ?? []) as unknown as InventoryItemRow[];
  const name = (x: { name_ar: string; name_en: string | null }) => (locale === "en" && x.name_en) || x.name_ar;
  const postable = accounts.filter((a) => a.is_postable && a.is_active);
  const opt = (list: typeof accounts) => list.map((a) => ({ id: a.id, label: `${a.code} — ${name(a)}` }));
  const can = ctx.can(PERMISSIONS.inventoryManage);
  const i = t.inventory;
  const edit = items.find((x) => x.id === sp.edit);
  const today = todayInTimeZone(ctx.hotel.timezone);

  return (
    <>
      <PageHeader title={t.nav.stock} description={i.subtitle}
        actions={can && <Button asChild><Link href="/inventory?new=1">{i.newItem}</Link></Button>} />
      {can && (edit || sp.new) && (
        <Card className="mb-6"><CardHeader><CardTitle>{edit ? t.common.edit : i.newItem}</CardTitle></CardHeader><CardContent>
          <SimpleForm key={edit?.id ?? "new"} columns={4} submitLabel={t.common.save} errors={t.errors} action={saveItemAction} onDone="/inventory"
            initial={{
              ...(edit ? { id: edit.id } : {}), sku: edit?.sku ?? "", name_ar: edit?.name_ar ?? "", name_en: edit?.name_en ?? "", unit: edit?.unit ?? "unit",
              inventory_account_id: edit?.inventory_account_id ?? "", expense_account_id: edit?.expense_account_id ?? "",
              reorder_level: edit ? toMoney(edit.reorder_level).toString() : "0", is_active: edit?.is_active ?? true,
            }}
            fields={[
              { name: "sku", label: i.sku, ltr: true }, { name: "name_ar", label: i.name }, { name: "name_en", label: `${i.name} (EN)`, ltr: true },
              { name: "unit", label: i.unit }, { name: "inventory_account_id", label: i.inventoryAccount, options: opt(postable.filter((a) => a.account_type === "asset" && a.code.startsWith("112"))) },
              { name: "expense_account_id", label: i.expenseAccount, options: opt(postable.filter((a) => a.account_type === "expense")) },
              { name: "reorder_level", label: i.reorder, type: "number" }, { name: "is_active", label: t.common.active, checkbox: true },
            ]} />
        </CardContent></Card>
      )}
      {can && items.length > 0 && (
        <Card className="mb-6"><CardHeader><CardTitle>{i.movement}</CardTitle></CardHeader><CardContent>
          <SimpleForm columns={4} submitLabel={t.common.save} errors={t.errors} action={inventoryMovementAction}
            initial={{ item_id: "", type: "issue", date: today, quantity: "", unit_cost: "", department_id: "", vendor_bill_id: "", description: "" }}
            fields={[
              { name: "item_id", label: i.name, options: items.filter((x) => x.is_active).map((x) => ({ id: x.id, label: `${x.sku} — ${name(x)}` })) },
              { name: "type", label: t.vouchers.type, options: (["receipt", "issue", "adjustment"] as const).map((k) => ({ id: k, label: i.types[k] })) },
              { name: "date", label: t.common.date, type: "date" }, { name: "quantity", label: t.folio.quantity, type: "number" },
              { name: "unit_cost", label: i.unitCost, type: "number" },
              { name: "department_id", label: t.folio.department, options: departments.map((d) => ({ id: d.id, label: `${d.code} — ${name(d)}` })), optional: true },
              { name: "vendor_bill_id", label: i.fromBill, options: (bills.data ?? []).map((b) => ({ id: b.id, label: `${b.bill_number} ${b.vendor_invoice_no ?? ""}` })), optional: true },
              { name: "description", label: t.common.description },
            ]} />
        </CardContent></Card>
      )}
      <Card className="overflow-hidden">
        <Table>
          <TableHeader><TableRow>
            <TableHead>{i.sku}</TableHead><TableHead>{i.name}</TableHead><TableHead>{i.unit}</TableHead>
            <TableHead className="text-end">{i.onHand}</TableHead><TableHead className="text-end">{i.avgCost}</TableHead>
            <TableHead className="text-end">{i.value}</TableHead><TableHead />{can && <TableHead />}
          </TableRow></TableHeader>
          <TableBody>
            {items.length === 0 && <TableRow><TableCell colSpan={8} className="py-10 text-center text-muted-foreground">{t.common.noData}</TableCell></TableRow>}
            {items.map((x) => {
              const low = toMoney(x.quantity_on_hand).lte(toMoney(x.reorder_level)) && toMoney(x.reorder_level).gt(0);
              return (
                <TableRow key={x.id} className={x.is_active ? "" : "opacity-50"}>
                  <TableCell className="num">{x.sku}</TableCell><TableCell>{name(x)}</TableCell><TableCell>{x.unit}</TableCell>
                  <TableCell className="num text-end">{toMoney(x.quantity_on_hand).toString()}</TableCell>
                  <TableCell className="text-end"><Money value={x.average_cost} locale={locale} decimals={4} /></TableCell>
                  <TableCell className="text-end"><Money value={toMoney(x.quantity_on_hand).times(toMoney(x.average_cost))} locale={locale} /></TableCell>
                  <TableCell>{low && <Badge variant="warning">{i.lowStock}</Badge>}</TableCell>
                  {can && <TableCell className="text-end"><Button asChild variant="ghost" size="sm"><Link href={`/inventory?edit=${x.id}`}>{t.common.edit}</Link></Button></TableCell>}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
