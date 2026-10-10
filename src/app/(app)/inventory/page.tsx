import { tr } from "@/i18n/tr";
import Link from "@/components/link";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { ZERO, toMoney } from "@/lib/accounting/money";
import type { InventoryItemRow } from "@/lib/supabase/database.types";
import { listAccounts, listDepartments } from "@/services/accounts.service";
import { raise } from "@/services/errors";
import { getI18n } from "@/i18n/server";
import {
  addUnitAction, bulkPriceAction, deleteUnitAction, generateBarcodeAction, inventoryMovementAction, saveCategoryAction, saveItemAction,
} from "../_assets/actions";
import { SimpleForm } from "../_assets/simple-form";
import { ActionButton } from "../_pms/action-button";
import { StockCountForm } from "./count-form";
import { Boxes, CalendarX2, Coins, PackageX, TriangleAlert } from "lucide-react";
import { Stat, StatGrid } from "@/components/ui/stat";
import { EmptyState } from "@/components/ui/empty-state";

const TABS = ["items", "count", "expiry", "prices", "setup"] as const;
type Tab = (typeof TABS)[number];

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ edit?: string; new?: string; tab?: string; q?: string; category?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.inventoryView);
  const { locale, t } = await getI18n();
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "items";
  const h = ctx.hotel.id;
  const today = todayInTimeZone(ctx.hotel.timezone);
  const soon = (() => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 30); return d.toISOString().slice(0, 10); })();
  const [itemsRes, accounts, departments, bills, catsRes, unitsRes, lotsRes, countsRes, pricesRes] = await Promise.all([
    ctx.supabase.from("inventory_items")
      .select("id, hotel_id, sku, name_ar, name_en, unit, inventory_account_id, expense_account_id, reorder_level::text, quantity_on_hand::text, average_cost::text, stock_value::text, is_active, created_at, created_by, updated_at, updated_by, category_id, barcode, sale_price::text, track_expiry")
      .eq("hotel_id", h).order("sku"),
    listAccounts(ctx.supabase, h),
    listDepartments(ctx.supabase, h),
    ctx.supabase.from("vendor_bills").select("id, bill_number, vendor_invoice_no").eq("hotel_id", h).order("bill_date", { ascending: false }).limit(50),
    ctx.supabase.from("inventory_categories").select("id, code, name_ar, name_en, is_active").eq("hotel_id", h).order("code"),
    ctx.supabase.from("inventory_units").select("id, name_ar, name_en").eq("hotel_id", h).order("name_ar"),
    ctx.supabase.from("inventory_lots").select("id, item_id, expiry_date, received_on, received_qty::text, remaining_qty::text")
      .eq("hotel_id", h).gt("remaining_qty", 0).order("expiry_date", { nullsFirst: false }),
    tab === "count" ? ctx.supabase.from("inventory_counts").select("id, count_number, count_date, note, items_counted, items_changed, value_difference::text")
      .eq("hotel_id", h).order("created_at", { ascending: false }).limit(20) : Promise.resolve({ data: [], error: null }),
    tab === "prices" ? ctx.supabase.from("inventory_price_changes").select("id, item_id, old_price::text, new_price::text, changed_at")
      .eq("hotel_id", h).order("changed_at", { ascending: false }).limit(50) : Promise.resolve({ data: [], error: null }),
  ]);
  raise(catsRes.error); raise(unitsRes.error); raise(lotsRes.error); raise(countsRes.error); raise(pricesRes.error);
  const items = (itemsRes.data ?? []) as unknown as InventoryItemRow[];
  const cats = catsRes.data ?? [];
  const units = unitsRes.data ?? [];
  const lots = lotsRes.data ?? [];
  const name = (x: { name_ar: string; name_en: string | null }) => (locale === "en" && x.name_en) || x.name_ar;
  const catName = (id: string | null) => { const c = cats.find((x) => x.id === id); return c ? name(c) : ""; };
  const byId = new Map(items.map((x) => [x.id, x]));
  const postable = accounts.filter((a) => a.is_postable && a.is_active);
  const opt = (list: typeof accounts) => list.map((a) => ({ id: a.id, label: `${a.code} ${name(a)}` }));
  const can = ctx.can(PERMISSIONS.inventoryManage);
  const i = t.inventory;
  const edit = items.find((x) => x.id === sp.edit);
  const lowCount = items.filter((x) => toMoney(x.quantity_on_hand).lte(toMoney(x.reorder_level)) && toMoney(x.reorder_level).gt(0)).length;
  const expiring = lots.filter((l) => l.expiry_date && l.expiry_date <= soon);
  const q = (sp.q ?? "").trim().toLowerCase();
  const shown = items.filter((x) => (!sp.category || x.category_id === sp.category)
    && (!q || x.sku.toLowerCase().includes(q) || x.name_ar.toLowerCase().includes(q) || (x.name_en ?? "").toLowerCase().includes(q) || (x.barcode ?? "").toLowerCase() === q));
  const unitOptions = [...new Set([...units.map((u) => u.name_ar), ...(edit ? [edit.unit] : [])])].map((u) => ({ id: u, label: u }));
  const catOptions = cats.filter((c) => c.is_active).map((c) => ({ id: c.id, label: `${c.code} ${name(c)}` }));
  const withBarcode = shown.filter((x) => x.barcode).map((x) => x.id);

  return (
    <>
      <PageHeader title={t.nav.stock}
        actions={<div className="flex flex-wrap gap-2">
          <Button asChild variant="outline"><Link href={`/reports/stock-balances`}>{tr("كشف الكميات")}</Link></Button>
          <Button asChild variant="outline"><Link href={`/reports/item-card`}>{tr("بطاقة صنف")}</Link></Button>
          {can && <Button asChild variant="outline"><Link href="/inventory?new=1">{i.newItem}</Link></Button>}
        </div>} />
      <StatGrid>
        <Stat icon={Boxes} tone="ink" label={tr("الأصناف")} value={<span className="num">{items.length}</span>} hint={tr("{0} فعّال", items.filter((x) => x.is_active).length)} />
        <Stat currency={ctx.hotel.base_currency} icon={Coins} tone="teal" label={tr("قيمة المخزون")} value={<Money value={items.reduce((s, x) => s.plus(toMoney(x.stock_value)), ZERO)} locale={locale} />} />
        <Stat icon={TriangleAlert} tone="clay" label={tr("تحت حد إعادة الطلب")} value={<span className="num">{lowCount}</span>} />
        <Stat icon={CalendarX2} tone="neutral" label={tr("منتهية أو تنتهي خلال 30 يومًا")} value={<span className="num">{expiring.length}</span>} />
        <Stat icon={PackageX} tone="neutral" label={tr("نفدت كميتها")} value={<span className="num">{items.filter((x) => x.is_active && toMoney(x.quantity_on_hand).lte(0)).length}</span>} />
      </StatGrid>

      <FilterTabs active={tab} items={[
        { key: "items", label: tr("الأصناف"), href: "/inventory", count: items.length },
        { key: "count", label: tr("الجرد"), href: "/inventory?tab=count" },
        { key: "expiry", label: tr("الصلاحية"), href: "/inventory?tab=expiry", count: expiring.length },
        { key: "prices", label: tr("الأسعار"), href: "/inventory?tab=prices" },
        { key: "setup", label: tr("الفئات والوحدات"), href: "/inventory?tab=setup" },
      ]} />

      {tab === "items" && (<>
        {can && (edit || sp.new) && (
          <Card className="mb-6"><CardHeader><CardTitle>{edit ? t.common.edit : i.newItem}</CardTitle></CardHeader><CardContent>
            <SimpleForm key={edit?.id ?? "new"} columns={4} submitLabel={t.common.save} errors={t.errors} action={saveItemAction} onDone="/inventory"
              initial={{
                ...(edit ? { id: edit.id } : {}), sku: edit?.sku ?? "", name_ar: edit?.name_ar ?? "", name_en: edit?.name_en ?? "", unit: edit?.unit ?? (unitOptions[0]?.id ?? ""),
                category_id: edit?.category_id ?? "", barcode: edit?.barcode ?? "", sale_price: edit?.sale_price ? toMoney(edit.sale_price).toString() : "",
                inventory_account_id: edit?.inventory_account_id ?? "", expense_account_id: edit?.expense_account_id ?? "",
                reorder_level: edit ? toMoney(edit.reorder_level).toString() : "0", track_expiry: edit?.track_expiry ?? false, is_active: edit?.is_active ?? true,
              }}
              fields={[
                { name: "sku", label: i.sku, ltr: true }, { name: "name_ar", label: i.name }, { name: "name_en", label: tr("{0} بالإنجليزية", i.name), ltr: true },
                unitOptions.length ? { name: "unit", label: i.unit, options: unitOptions } : { name: "unit", label: i.unit },
                { name: "category_id", label: tr("الفئة"), options: catOptions, optional: true },
                { name: "barcode", label: tr("الباركود (اتركه فارغًا لتوليده لاحقًا)"), ltr: true },
                { name: "sale_price", label: tr("سعر البيع"), type: "number" },
                { name: "inventory_account_id", label: i.inventoryAccount, options: opt(postable.filter((a) => a.account_type === "asset" && a.code.startsWith("112"))) },
                { name: "expense_account_id", label: i.expenseAccount, options: opt(postable.filter((a) => a.account_type === "expense")) },
                { name: "reorder_level", label: i.reorder, type: "number" },
                { name: "track_expiry", label: tr("يتتبع تاريخ الصلاحية"), checkbox: true },
                { name: "is_active", label: t.common.active, checkbox: true },
              ]} />
          </CardContent></Card>
        )}
        {can && items.length > 0 && (
          <Card className="mb-6"><CardHeader><CardTitle>{i.movement}</CardTitle></CardHeader><CardContent>
            <SimpleForm columns={4} submitLabel={t.common.save} errors={t.errors} action={inventoryMovementAction}
              initial={{ item_id: "", type: "issue", date: today, quantity: "", unit_cost: "", expiry_date: "", department_id: "", vendor_bill_id: "", description: "" }}
              fields={[
                { name: "item_id", label: i.name, options: items.filter((x) => x.is_active).map((x) => ({ id: x.id, label: `${x.sku} ${name(x)}${x.barcode ? ` ${x.barcode}` : ""}` })) },
                { name: "type", label: t.vouchers.type, options: (["receipt", "issue", "adjustment"] as const).map((k) => ({ id: k, label: i.types[k] })) },
                { name: "date", label: t.common.date, type: "date" }, { name: "quantity", label: t.folio.quantity, type: "number" },
                { name: "unit_cost", label: i.unitCost, type: "number" },
                { name: "expiry_date", label: tr("تاريخ الصلاحية (للوارد)"), type: "date" },
                { name: "department_id", label: t.folio.department, options: departments.map((d) => ({ id: d.id, label: `${d.code} ${name(d)}` })), optional: true },
                { name: "vendor_bill_id", label: i.fromBill, options: (bills.data ?? []).map((b) => ({ id: b.id, label: `${b.bill_number} ${b.vendor_invoice_no ?? ""}` })), optional: true },
                { name: "description", label: t.common.description },
              ]} />
          </CardContent></Card>
        )}
        <form className="toolbar">
          <Input name="q" defaultValue={sp.q ?? ""} placeholder={tr("ابحث بالرمز أو الاسم أو الباركود")} aria-label={tr("بحث")} className="w-72" />
          {cats.length > 0 && (
            <NativeSelect name="category" defaultValue={sp.category ?? ""} className="w-52" aria-label={tr("الفئة")}>
              <option value="">{tr("كل الفئات")}</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{name(c)}</option>)}
            </NativeSelect>
          )}
          <Button type="submit" variant="outline">{t.common.apply}</Button>
          {withBarcode.length > 0 && (
            <Button asChild variant="outline"><a href={`/print/labels?items=${withBarcode.slice(0, 200).join(",")}`} target="_blank" rel="noopener">{tr("طباعة ملصقات الباركود")}</a></Button>
          )}
        </form>
        <Card className="overflow-hidden">
          <Table>
            <TableHeader><TableRow>
              <TableHead>{i.sku}</TableHead><TableHead>{i.name}</TableHead><TableHead>{tr("الفئة")}</TableHead><TableHead>{tr("الباركود")}</TableHead><TableHead>{i.unit}</TableHead>
              <TableHead className="text-end">{i.onHand}</TableHead><TableHead className="text-end">{i.avgCost}</TableHead>
              <TableHead className="text-end">{i.value}</TableHead><TableHead className="text-end">{tr("سعر البيع")}</TableHead><TableHead />{can && <TableHead />}
            </TableRow></TableHeader>
            <TableBody>
              {shown.length === 0 && <TableRow><TableCell colSpan={11} className="py-8"><EmptyState title={tr("لا توجد أصناف مخزون")} description={tr("أضف أصناف المطبخ والمتجر والمستلزمات لتتبع كمياتها وتكلفتها المتوسطة.")} actionHref="/inventory?new=1" actionLabel={i.newItem} icon={Boxes} /></TableCell></TableRow>}
              {shown.map((x) => {
                const low = toMoney(x.quantity_on_hand).lte(toMoney(x.reorder_level)) && toMoney(x.reorder_level).gt(0);
                return (
                  <TableRow key={x.id} className={x.is_active ? "" : "opacity-50"}>
                    <TableCell className="num font-semibold"><Link href={`/reports/item-card?item=${x.id}`} className="text-action">{x.sku}</Link></TableCell>
                    <TableCell className="font-medium">{name(x)}</TableCell>
                    <TableCell className="text-slate-600">{catName(x.category_id)}</TableCell>
                    <TableCell className="num text-[14px]">
                      {x.barcode ?? (can ? <ActionButton run={generateBarcodeAction.bind(null, x.id)} label={tr("توليد")} done={tr("وُلّد الباركود")} errors={t.errors} variant="ghost" /> : "")}
                    </TableCell>
                    <TableCell className="text-slate-600">{x.unit}</TableCell>
                    <TableCell className="num text-end">{toMoney(x.quantity_on_hand).toString()}</TableCell>
                    <TableCell className="text-end"><Money value={x.average_cost} locale={locale} decimals={4} /></TableCell>
                    <TableCell className="text-end font-semibold"><Money value={x.stock_value} locale={locale} /></TableCell>
                    <TableCell className="text-end">{x.sale_price ? <Money value={x.sale_price} locale={locale} /> : ""}</TableCell>
                    <TableCell>{low && <Badge variant="warning">{i.lowStock}</Badge>}{x.track_expiry && <Badge variant="outline" className="ms-1">{tr("صلاحية")}</Badge>}</TableCell>
                    {can && <TableCell className="text-end"><Button asChild variant="ghost" size="sm"><Link href={`/inventory?edit=${x.id}`}>{t.common.edit}</Link></Button></TableCell>}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      </>)}

      {tab === "count" && (<>
        <p className="max-w-3xl text-[15px] leading-relaxed text-slate-600">
          {tr("اطبع كشف الجرد، وعدّ الأصناف فعليًا، ثم أدخل الكميات المعدودة هنا. الأصناف التي تتركها فارغة لا تتغير. كل فرق يُرحَّل تسوية مخزون بمتوسط التكلفة على حساب فروقات الجرد.")}
        </p>
        <div className="flex gap-2"><Button asChild variant="outline"><a href={`/print/reports/count-sheet?to=${today}`} target="_blank" rel="noopener">{tr("طباعة كشف الجرد")}</a></Button></div>
        {can ? (
          <Card className="p-4">
            <StockCountForm today={today} errors={t.errors} items={items.filter((x) => x.is_active).map((x) => ({
              id: x.id, sku: x.sku, name: name(x), unit: x.unit, barcode: x.barcode, onHand: x.quantity_on_hand, avgCost: x.average_cost, category: catName(x.category_id),
            }))} />
          </Card>
        ) : <p className="text-slate-500">{tr("ترحيل الجرد لمن يملك إدارة المخزون.")}</p>}
        {(countsRes.data ?? []).length > 0 && (
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">{tr("سجل الجرد")}</h2>
            <Card className="overflow-hidden"><Table>
              <TableHeader><TableRow><TableHead>{tr("الرقم")}</TableHead><TableHead>{tr("التاريخ")}</TableHead><TableHead className="text-end">{tr("أصناف معدودة")}</TableHead>
                <TableHead className="text-end">{tr("بفروقات")}</TableHead><TableHead className="text-end">{tr("قيمة الفروقات")}</TableHead><TableHead>{tr("ملاحظة")}</TableHead></TableRow></TableHeader>
              <TableBody>{(countsRes.data ?? []).map((c) => (
                <TableRow key={c.id}><TableCell className="num">{c.count_number}</TableCell><TableCell className="num">{c.count_date}</TableCell>
                  <TableCell className="num text-end">{c.items_counted}</TableCell><TableCell className="num text-end">{c.items_changed}</TableCell>
                  <TableCell className="text-end"><Money value={c.value_difference} locale={locale} /></TableCell><TableCell>{c.note ?? ""}</TableCell></TableRow>
              ))}</TableBody>
            </Table></Card>
          </section>
        )}
      </>)}

      {tab === "expiry" && (<>
        <div className="flex gap-2"><Button asChild variant="outline"><Link href="/reports/expiring-stock">{tr("تقرير القريب انتهاؤه")}</Link></Button></div>
        {lots.length === 0 ? (
          <EmptyState icon={CalendarX2} title={tr("لا دفعات بصلاحية")} description={tr("فعّل «يتتبع تاريخ الصلاحية» للصنف، ثم أدخل تاريخ الصلاحية مع كل وارد. الصرف يُخصم من الأقرب انتهاءً أولًا.")} />
        ) : (
          <Card className="overflow-hidden"><Table>
            <TableHeader><TableRow><TableHead>{tr("الصنف")}</TableHead><TableHead>{tr("تاريخ الوارد")}</TableHead><TableHead>{tr("تاريخ الانتهاء")}</TableHead>
              <TableHead className="text-end">{tr("الوارد")}</TableHead><TableHead className="text-end">{tr("المتبقي")}</TableHead><TableHead>{tr("الحالة")}</TableHead></TableRow></TableHeader>
            <TableBody>{lots.map((l) => {
              const it = byId.get(l.item_id);
              const expired = l.expiry_date && l.expiry_date < today, near = l.expiry_date && !expired && l.expiry_date <= soon;
              return (
                <TableRow key={l.id}>
                  <TableCell>{it ? <><span className="num font-semibold">{it.sku}</span> {name(it)}</> : ""}</TableCell>
                  <TableCell className="num">{l.received_on}</TableCell><TableCell className="num">{l.expiry_date ?? tr("غير محدد")}</TableCell>
                  <TableCell className="num text-end">{toMoney(l.received_qty).toString()}</TableCell><TableCell className="num text-end">{toMoney(l.remaining_qty).toString()}</TableCell>
                  <TableCell>{expired ? <Badge variant="destructive">{tr("منتهٍ")}</Badge> : near ? <Badge variant="warning">{tr("قريب الانتهاء")}</Badge> : <Badge variant="success">{tr("صالح")}</Badge>}</TableCell>
                </TableRow>
              );
            })}</TableBody>
          </Table></Card>
        )}
      </>)}

      {tab === "prices" && (<>
        <div className="flex gap-2"><Button asChild variant="outline"><Link href="/reports/item-prices">{tr("تقرير أسعار الأصناف")}</Link></Button></div>
        {can && (
          <Card><CardHeader><CardTitle>{tr("تعديل الأسعار جماعيًا")}</CardTitle></CardHeader><CardContent>
            <p className="mb-3 text-[14px] text-slate-500">{tr("نسبة موجبة للرفع وسالبة للخفض، على أسعار البيع الحالية للأصناف الفعالة. التقريب اختياري، مثل 0.5 أو 1.")}</p>
            <SimpleForm columns={4} submitLabel={tr("تطبيق")} errors={t.errors} action={bulkPriceAction}
              initial={{ percent: "", category_id: "", round_to: "" }}
              fields={[
                { name: "percent", label: tr("النسبة %"), ltr: true },
                { name: "category_id", label: tr("الفئة"), options: catOptions, optional: true },
                { name: "round_to", label: tr("التقريب لأقرب"), ltr: true },
              ]} />
          </CardContent></Card>
        )}
        {(pricesRes.data ?? []).length > 0 && (
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">{tr("سجل تغيير الأسعار")}</h2>
            <Card className="overflow-hidden"><Table>
              <TableHeader><TableRow><TableHead>{tr("التاريخ")}</TableHead><TableHead>{tr("الصنف")}</TableHead>
                <TableHead className="text-end">{tr("السعر السابق")}</TableHead><TableHead className="text-end">{tr("السعر الجديد")}</TableHead></TableRow></TableHeader>
              <TableBody>{(pricesRes.data ?? []).map((c) => {
                const it = byId.get(c.item_id);
                return (
                  <TableRow key={c.id}><TableCell className="num">{c.changed_at.slice(0, 10)}</TableCell>
                    <TableCell>{it ? <><span className="num font-semibold">{it.sku}</span> {name(it)}</> : ""}</TableCell>
                    <TableCell className="text-end">{c.old_price ? <Money value={c.old_price} locale={locale} /> : ""}</TableCell>
                    <TableCell className="text-end">{c.new_price ? <Money value={c.new_price} locale={locale} /> : ""}</TableCell></TableRow>
                );
              })}</TableBody>
            </Table></Card>
          </section>
        )}
      </>)}

      {tab === "setup" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card><CardHeader><CardTitle>{tr("فئات الأصناف")}</CardTitle></CardHeader><CardContent className="space-y-3">
            {can && <SimpleForm columns={2} submitLabel={tr("إضافة فئة")} errors={t.errors} action={saveCategoryAction}
              initial={{ code: "", name_ar: "", name_en: "" }}
              fields={[{ name: "code", label: tr("الرمز"), ltr: true }, { name: "name_ar", label: tr("الاسم") }, { name: "name_en", label: tr("الاسم بالإنجليزية"), ltr: true }]} />}
            <ul className="divide-y divide-line rounded-lg border border-line">
              {cats.length === 0 && <li className="p-3 text-slate-500">{tr("لا فئات بعد، مثل: مواد غذائية، منظفات، ميني بار.")}</li>}
              {cats.map((c) => (
                <li key={c.id} className="flex items-center justify-between p-3">
                  <span><span className="num font-semibold">{c.code}</span> {name(c)}</span>
                  <span className="num text-[13px] text-slate-500">{tr("{0} صنف", items.filter((x) => x.category_id === c.id).length)}</span>
                </li>
              ))}
            </ul>
          </CardContent></Card>
          <Card><CardHeader><CardTitle>{tr("وحدات القياس")}</CardTitle></CardHeader><CardContent className="space-y-3">
            {can && <SimpleForm columns={2} submitLabel={tr("إضافة وحدة")} errors={t.errors} action={addUnitAction}
              initial={{ name_ar: "", name_en: "" }}
              fields={[{ name: "name_ar", label: tr("الاسم") }, { name: "name_en", label: tr("الاسم بالإنجليزية"), ltr: true }]} />}
            <ul className="divide-y divide-line rounded-lg border border-line">
              {units.map((u) => (
                <li key={u.id} className="flex items-center justify-between p-3">
                  <span>{u.name_ar}{u.name_en && <span className="ms-2 text-slate-500">{u.name_en}</span>}</span>
                  {can && !items.some((x) => x.unit === u.name_ar) && (
                    <ActionButton run={deleteUnitAction.bind(null, u.id)} label={tr("حذف")} done={tr("حُذفت الوحدة")} errors={t.errors} variant="ghost" confirmText={tr("حذف الوحدة؟")} />
                  )}
                </li>
              ))}
            </ul>
          </CardContent></Card>
        </div>
      )}
    </>
  );
}
