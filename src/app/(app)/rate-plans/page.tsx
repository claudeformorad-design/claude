import Link from "@/components/link";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { listCompanyOptions, listRoomTypes } from "@/services/pms.service";
import { listRatePlans } from "@/services/operations.service";
import { getI18n } from "@/i18n/server";
import { SimpleForm } from "../_assets/simple-form";
import { saveRatePlanAction } from "../_ops/actions";

/**
 * خطط الأسعار: تعديل نسبي على سعر الليلة (خصم أو زيادة) وإضافة ثابتة لكل ليلة (مثل الإفطار لكل شخص)،
 * ويمكن قصر الخطة على شركة (سعر تعاقدي) أو نوع غرفة. تُختار الخطة من صفحة الحجز فيُعاد تسعير لياليه.
 */
export default async function RatePlansPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.pmsView);
  const { locale, t } = await getI18n();
  const sp = await searchParams;
  const [plans, types, companies] = await Promise.all([
    listRatePlans(ctx.supabase, ctx.hotel.id), listRoomTypes(ctx.supabase, ctx.hotel.id), listCompanyOptions(ctx.supabase, ctx.hotel.id),
  ]);
  const canManage = ctx.can(PERMISSIONS.pmsRatesManage);
  const edit = plans.find((p) => p.id === sp.edit);
  const typeName = new Map(types.map((x) => [x.id, x.name_ar]));
  const companyName = new Map(companies.map((c) => [c.id, c.label]));

  return (
    <>
      <PageHeader title="خطط الأسعار" description="إقامة فقط، مع الإفطار، أسعار الشركات والعروض — تُطبَّق على الأسعار والمواسم القياسية" />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="overflow-hidden">
          <Table>
            <TableHeader><TableRow><TableHead>الخطة</TableHead><TableHead className="text-end">التعديل</TableHead><TableHead className="text-end">إضافة لكل ليلة</TableHead><TableHead>النطاق</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {plans.length === 0 && <TableRow><TableCell colSpan={5} className="py-10 text-center text-slate-500">لا خطط بعد — الحجوزات تُسعَّر بالسعر القياسي</TableCell></TableRow>}
              {plans.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="cell-fluid">
                    <span className="num font-semibold">{p.code}</span> <span className="text-ink">{p.name_ar}</span>
                    {p.includes_breakfast && <Badge variant="info" className="ms-2">يشمل الإفطار</Badge>}
                    {!p.is_active && <Badge variant="secondary" className="ms-2">موقوفة</Badge>}
                  </TableCell>
                  <TableCell className="num text-end">{Number(p.adjust_pct) === 0 ? "—" : `${Number(p.adjust_pct) > 0 ? "+" : ""}${Number(p.adjust_pct)}%`}</TableCell>
                  <TableCell className="text-end"><Money value={p.per_night} locale={locale} blankZero />{Number(p.per_night) > 0 && <span className="block text-[13px] text-slate-500">{p.per_person ? "لكل شخص" : "لكل غرفة"}</span>}</TableCell>
                  <TableCell className="text-[14.5px]">{[p.customer_id && companyName.get(p.customer_id), p.room_type_id && typeName.get(p.room_type_id)].filter(Boolean).join(" · ") || "الكل"}</TableCell>
                  <TableCell className="text-end">{canManage && <Link href={`/rate-plans?edit=${p.id}`} className="text-action hover:underline">تعديل</Link>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        {canManage && (
          <Card className="h-fit">
            <CardHeader><CardTitle>{edit ? "تعديل الخطة" : "خطة جديدة"}</CardTitle><CardDescription>مثال: «مع الإفطار» = 0% + 25 لكل شخص؛ «سعر الشركة» = −15% لشركة محددة</CardDescription></CardHeader>
            <CardContent>
              <SimpleForm key={edit?.id ?? "new"} columns={1} submitLabel="حفظ الخطة" errors={t.errors} action={saveRatePlanAction} onDone="/rate-plans"
                initial={{
                  id: edit?.id ?? "", code: edit?.code ?? "", name_ar: edit?.name_ar ?? "", adjust_pct: edit ? String(Number(edit.adjust_pct)) : "0",
                  per_night: edit ? String(Number(edit.per_night)) : "0", per_person: edit?.per_person ?? false, includes_breakfast: edit?.includes_breakfast ?? false,
                  customer_id: edit?.customer_id ?? "", room_type_id: edit?.room_type_id ?? "", description: edit?.description ?? "", is_active: edit?.is_active ?? true,
                }}
                fields={[
                  { name: "code", label: "الرمز", ltr: true }, { name: "name_ar", label: "الاسم" },
                  { name: "adjust_pct", label: "نسبة التعديل % (سالب = خصم)", type: "number" },
                  { name: "per_night", label: "إضافة لكل ليلة", type: "number" },
                  { name: "per_person", label: "الإضافة لكل شخص بالغ", checkbox: true },
                  { name: "includes_breakfast", label: "تشمل الإفطار", checkbox: true },
                  { name: "customer_id", label: "لشركة محددة (اختياري)", options: companies, optional: true },
                  { name: "room_type_id", label: "لنوع غرفة (اختياري)", options: types.filter((x) => x.booking_mode === "nightly").map((x) => ({ id: x.id, label: x.name_ar })), optional: true },
                  ...(edit ? [{ name: "is_active", label: "مفعّلة", checkbox: true as const }] : []),
                ]} />
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
