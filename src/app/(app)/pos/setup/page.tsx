import Link from "@/components/link";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  const codeName = new Map(codes.map((c) => [c.id, `${c.code} ${c.name_ar}`]));
  const outletName = new Map(outlets.map((o) => [o.id, o.name_ar]));
  const editItem = items.find((i) => i.id === sp.item);
  const editOutlet = outlets.find((o) => o.id === sp.outlet);
  const food = codes.find((c) => c.code === "FOOD")?.id ?? codes[0]?.id ?? "";

  return (
    <>
      <PageHeader title="إعداد نقاط البيع" description="المطعم والكافيه وخدمة الغرف، بأصنافها وأسعارها"
        actions={<Button asChild variant="outline"><Link href="/pos">شاشة البيع</Link></Button>} />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <CardHeader><CardTitle>الأصناف</CardTitle></CardHeader>
            <Table>
              <TableHeader><TableRow><TableHead>الصنف</TableHead><TableHead>النقطة</TableHead><TableHead>رمز الإيراد</TableHead><TableHead className="text-end">السعر</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {items.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-slate-500">لا أصناف بعد</TableCell></TableRow>}
                {items.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="cell-fluid"><span className="font-medium text-ink">{i.name_ar}</span>{i.category && <span className="block text-[13.5px] text-slate-500">{i.category}</span>}{!i.is_active && <Badge variant="secondary" className="ms-2">موقوف</Badge>}</TableCell>
                    <TableCell>{outletName.get(i.outlet_id)}</TableCell>
                    <TableCell className="text-[14.5px]">{codeName.get(i.charge_code_id)}</TableCell>
                    <TableCell className="text-end"><Money value={i.price} locale={locale} /></TableCell>
                    <TableCell className="text-end"><Link href={`/pos/setup?item=${i.id}`} className="text-action">تعديل</Link></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <Card className="overflow-hidden">
            <CardHeader><CardTitle>نقاط البيع</CardTitle></CardHeader>
            <Table>
              <TableBody>
                {outlets.length === 0 && <TableRow><TableCell className="py-8 text-center text-slate-500">لا نقاط بيع بعد</TableCell></TableRow>}
                {outlets.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="num font-semibold">{o.code}</TableCell>
                    <TableCell className="cell-fluid">{o.name_ar}{!o.is_active && <Badge variant="secondary" className="ms-2">موقوفة</Badge>}</TableCell>
                    <TableCell className="text-end"><Link href={`/pos/setup?outlet=${o.id}`} className="text-action">تعديل</Link></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>{editOutlet ? "تعديل نقطة البيع" : "نقطة بيع جديدة"}</CardTitle></CardHeader>
            <CardContent>
              <SimpleForm key={editOutlet?.id ?? "new-outlet"} columns={1} submitLabel="حفظ النقطة" errors={t.errors} action={saveOutletAction} onDone="/pos/setup"
                initial={{ id: editOutlet?.id ?? "", code: editOutlet?.code ?? "", name_ar: editOutlet?.name_ar ?? "", is_active: editOutlet?.is_active ?? true }}
                fields={[{ name: "code", label: "الرمز", ltr: true }, { name: "name_ar", label: "الاسم، مثل المطعم" }, ...(editOutlet ? [{ name: "is_active", label: "مفعّلة", checkbox: true as const }] : [])]} />
            </CardContent>
          </Card>
          {outlets.length > 0 && (
            <Card>
              <CardHeader><CardTitle>{editItem ? "تعديل صنف" : "صنف جديد"}</CardTitle></CardHeader>
              <CardContent>
                <SimpleForm key={editItem?.id ?? "new-item"} columns={1} submitLabel="حفظ الصنف" errors={t.errors} action={savePosItemAction} onDone="/pos/setup"
                  initial={{
                    id: editItem?.id ?? "", outlet_id: editItem?.outlet_id ?? outlets[0]!.id, item_name: editItem?.name_ar ?? "", category: editItem?.category ?? "",
                    price: editItem ? String(Number(editItem.price)) : "", charge_code_id: editItem?.charge_code_id ?? food, is_active: editItem?.is_active ?? true,
                  }}
                  fields={[
                    { name: "outlet_id", label: "النقطة", options: outlets.map((o) => ({ id: o.id, label: o.name_ar })) },
                    { name: "item_name", label: "اسم الصنف" },
                    { name: "category", label: "التصنيف، مثل مشروبات أو أطباق رئيسية" },
                    { name: "price", label: "السعر", type: "number" },
                    { name: "charge_code_id", label: "رمز الإيراد", options: codes.filter((c) => c.is_active).map((c) => ({ id: c.id, label: `${c.code} ${c.name_ar}` })) },
                    ...(editItem ? [{ name: "is_active", label: "مفعّل", checkbox: true as const }] : []),
                  ]} />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
