import { localNameOf } from "@/lib/local-name";
import { tr } from "@/i18n/tr";
import { FormDialog, RouteDialog } from "@/components/ui/dialog";
import { CodeName } from "@/components/ui/code-text";
import Link from "@/components/link";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { listOutlets, listPosItems } from "@/services/operations.service";
import { listChargeCodes } from "@/services/revenue-settings.service";
import { getI18n } from "@/i18n/server";
import { SimpleForm } from "../../_assets/simple-form";
import { saveOutletAction, savePosItemAction } from "../../_ops/actions";

/** إعداد نقاط البيع وأصنافها: كل صنف بسعره ورمز إيراده (الذي يحدد حساب الإيراد والضريبة) */
export default async function PosSetupPage({ searchParams }: { searchParams: Promise<{ item?: string; outlet?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.posManage);
  const { locale, t } = await getI18n();
  const sp = await searchParams;
  const [outlets, items, codes] = await Promise.all([
    listOutlets(ctx.supabase, ctx.hotel.id), listPosItems(ctx.supabase, ctx.hotel.id), listChargeCodes(ctx.supabase, ctx.hotel.id),
  ]);
  const codeName = new Map(codes.map((c) => [c.id, `${c.code} ${localNameOf(c)}`]));
  const outletName = new Map(outlets.map((o) => [o.id, o.name_ar]));
  const editItem = items.find((i) => i.id === sp.item);
  const editOutlet = outlets.find((o) => o.id === sp.outlet);
  const food = codes.find((c) => c.code === "FOOD")?.id ?? codes[0]?.id ?? "";

  type Outlet = (typeof outlets)[number];
  type Item = (typeof items)[number];
  const outletForm = (o?: Outlet) => (
    <SimpleForm key={o?.id ?? "new-outlet"} columns={2} submitLabel={tr("حفظ النقطة")} errors={t.errors} action={saveOutletAction} onDone="/pos/setup"
      initial={{ id: o?.id ?? "", code: o?.code ?? "", name_ar: o?.name_ar ?? "", is_active: o?.is_active ?? true }}
      fields={[{ name: "code", label: tr("الرمز"), ltr: true }, { name: "name_ar", label: tr("الاسم، مثل المطعم") }, ...(o ? [{ name: "is_active", label: tr("مفعّلة"), checkbox: true as const }] : [])]} />
  );
  const itemForm = (i?: Item) => (
    <SimpleForm key={i?.id ?? "new-item"} columns={2} submitLabel={tr("حفظ الصنف")} errors={t.errors} action={savePosItemAction} onDone="/pos/setup"
      initial={{
        id: i?.id ?? "", outlet_id: i?.outlet_id ?? outlets[0]?.id ?? "", item_name: i?.name_ar ?? "", category: i?.category ?? "",
        price: i ? String(Number(i.price)) : "", charge_code_id: i?.charge_code_id ?? food, is_active: i?.is_active ?? true,
      }}
      fields={[
        { name: "outlet_id", label: tr("النقطة"), options: outlets.map((x) => ({ id: x.id, label: localNameOf(x) })) },
        { name: "item_name", label: tr("اسم الصنف") },
        { name: "category", label: tr("التصنيف، مثل مشروبات أو أطباق رئيسية") },
        { name: "price", label: tr("السعر"), type: "number" },
        { name: "charge_code_id", label: tr("رمز الإيراد"), options: codes.filter((c) => c.is_active).map((c) => ({ id: c.id, label: `${c.code} ${localNameOf(c)}` })) },
        ...(i ? [{ name: "is_active", label: tr("مفعّل"), checkbox: true as const }] : []),
      ]} />
  );

  return (
    <>
      <PageHeader title={tr("إعداد نقاط البيع")}
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline"><Link href="/pos">{tr("شاشة البيع")}</Link></Button>
            <FormDialog label={tr("نقطة بيع جديدة")} title={tr("نقطة بيع جديدة")} variant="outline">{outletForm()}</FormDialog>
            {outlets.length > 0 && <FormDialog label={tr("صنف جديد")} title={tr("صنف جديد")}>{itemForm()}</FormDialog>}
          </div>
        } />
      <div className="grid gap-6">
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <CardHeader><CardTitle>{tr("الأصناف")}</CardTitle></CardHeader>
            <Table>
              <TableHeader><TableRow><TableHead>{tr("الصنف")}</TableHead><TableHead>{tr("النقطة")}</TableHead><TableHead>{tr("رمز الإيراد")}</TableHead><TableHead className="text-end">{tr("السعر")}</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {items.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-slate-500">{tr("لا أصناف بعد")}</TableCell></TableRow>}
                {items.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="cell-fluid"><span className="font-medium text-ink">{localNameOf(i)}</span>{i.category && <span className="block text-[13.5px] text-slate-500">{i.category}</span>}{!i.is_active && <Badge variant="secondary" className="ms-2">{tr("موقوف")}</Badge>}</TableCell>
                    <TableCell>{outletName.get(i.outlet_id)}</TableCell>
                    <TableCell><CodeName label={codeName.get(i.charge_code_id) ?? ""} /></TableCell>
                    <TableCell className="text-end"><Money value={i.price} locale={locale} /></TableCell>
                    <TableCell className="text-end"><Link href={`/pos/setup?item=${i.id}`} className="text-action">{tr("تعديل")}</Link></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <Card className="overflow-hidden">
            <CardHeader><CardTitle>{tr("نقاط البيع")}</CardTitle></CardHeader>
            <Table>
              <TableBody>
                {outlets.length === 0 && <TableRow><TableCell className="py-8 text-center text-slate-500">{tr("لا نقاط بيع بعد")}</TableCell></TableRow>}
                {outlets.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="num font-semibold">{o.code}</TableCell>
                    <TableCell className="cell-fluid">{localNameOf(o)}{!o.is_active && <Badge variant="secondary" className="ms-2">{tr("موقوفة")}</Badge>}</TableCell>
                    <TableCell className="text-end"><Link href={`/pos/setup?outlet=${o.id}`} className="text-action">{tr("تعديل")}</Link></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
        {editOutlet && <RouteDialog key={editOutlet.id} closeHref="/pos/setup" title={tr("تعديل {0}", editOutlet.name_ar)}>{outletForm(editOutlet)}</RouteDialog>}
        {editItem && <RouteDialog key={editItem.id} closeHref="/pos/setup" title={tr("تعديل {0}", editItem.name_ar)}>{itemForm(editItem)}</RouteDialog>}
      </div>
    </>
  );
}
