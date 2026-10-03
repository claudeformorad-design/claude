import { FormDialog, RouteDialog } from "@/components/ui/dialog";
import { CodeTag } from "@/components/ui/code-text";
import Link from "@/components/link";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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

  const planHint = "مثال: مع الإفطار = 0% و25 لكل شخص، وسعر الشركة = خصم 15% لشركة محددة";
  const planForm = (e?: (typeof plans)[number]) => (
    <SimpleForm key={e?.id ?? "new"} columns={2} submitLabel="حفظ الخطة" errors={t.errors} action={saveRatePlanAction} onDone="/rate-plans"
      initial={{
        id: e?.id ?? "", code: e?.code ?? "", name_ar: e?.name_ar ?? "", adjust_pct: e ? String(Number(e.adjust_pct)) : "0",
        per_night: e ? String(Number(e.per_night)) : "0", per_person: e?.per_person ?? false, includes_breakfast: e?.includes_breakfast ?? false,
        customer_id: e?.customer_id ?? "", room_type_id: e?.room_type_id ?? "", description: e?.description ?? "", is_active: e?.is_active ?? true,
      }}
      fields={[
        { name: "code", label: "الرمز", ltr: true }, { name: "name_ar", label: "الاسم" },
        { name: "adjust_pct", label: "نسبة التعديل %، والسالب خصم", type: "number" },
        { name: "per_night", label: "إضافة لكل ليلة", type: "number" },
        { name: "per_person", label: "الإضافة لكل شخص بالغ", checkbox: true },
        { name: "includes_breakfast", label: "تشمل الإفطار", checkbox: true },
        { name: "customer_id", label: "لشركة محددة", options: companies, optional: true },
        { name: "room_type_id", label: "لنوع غرفة محدد", options: types.filter((x) => x.booking_mode === "nightly").map((x) => ({ id: x.id, label: x.name_ar })), optional: true },
        ...(e ? [{ name: "is_active", label: "مفعّلة", checkbox: true as const }] : []),
      ]} />
  );

  return (
    <>
      <PageHeader title="خطط الأسعار"
        actions={canManage && <FormDialog label="خطة جديدة" title="خطة جديدة" description={planHint}>{planForm()}</FormDialog>} />
      <div className="grid gap-6">
        <Card className="overflow-hidden">
          <Table>
            <TableHeader><TableRow><TableHead>الخطة</TableHead><TableHead className="text-end">التعديل</TableHead><TableHead className="text-end">إضافة لكل ليلة</TableHead><TableHead>النطاق</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {plans.length === 0 && <TableRow><TableCell colSpan={5} className="py-10 text-center text-slate-500">لا خطط بعد، والحجوزات تُسعَّر بالسعر القياسي</TableCell></TableRow>}
              {plans.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="cell-fluid">
                    <span className="text-ink">{p.name_ar}</span><CodeTag>{p.code}</CodeTag>
                    {p.includes_breakfast && <Badge variant="info" className="ms-2">يشمل الإفطار</Badge>}
                    {!p.is_active && <Badge variant="secondary" className="ms-2">موقوفة</Badge>}
                  </TableCell>
                  <TableCell className="num text-end">{Number(p.adjust_pct) === 0 ? "" : `${Number(p.adjust_pct) > 0 ? "+" : ""}${Number(p.adjust_pct)}%`}</TableCell>
                  <TableCell className="whitespace-nowrap text-end"><Money value={p.per_night} locale={locale} blankZero />{Number(p.per_night) > 0 && <span className="ms-1.5 text-slate-500">{p.per_person ? "لكل شخص" : "لكل غرفة"}</span>}</TableCell>
                  <TableCell>{[p.customer_id && companyName.get(p.customer_id), p.room_type_id && typeName.get(p.room_type_id)].filter(Boolean).join("، ") || "الكل"}</TableCell>
                  <TableCell className="text-end">{canManage && <Link href={`/rate-plans?edit=${p.id}`} className="text-action">تعديل</Link>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        {canManage && edit && (
          <RouteDialog key={edit.id} closeHref="/rate-plans" title={`تعديل ${edit.name_ar}`} description={planHint}>{planForm(edit)}</RouteDialog>
        )}
      </div>
    </>
  );
}
