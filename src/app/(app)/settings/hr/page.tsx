import Link from "@/components/link";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { FormDialog, RouteDialog } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { hhmm } from "@/lib/hr/labels";
import type { HrLeaveTypeRow, HrPayComponentRow, HrShiftRow } from "@/lib/supabase/database.types";
import { getHrSettings, listLeaveTypes, listPayComponents, listShifts } from "@/services/hr.service";
import { getI18n } from "@/i18n/server";
import { SimpleForm } from "../../_assets/simple-form";
import { saveLeaveTypeAction, savePayComponentAction, saveShiftAction } from "../../hr/actions";
import { HrSettingsForm } from "./settings-form";

/** إعدادات الموارد البشرية: القواعد العامة، وأنواع الإجازات، وبنود الراتب، والورديات */
export default async function HrSettingsPage({ searchParams }: { searchParams: Promise<{ leave?: string; component?: string; shift?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.hrView);
  const { t } = await getI18n();
  const sp = await searchParams;
  const canEdit = ctx.can(PERMISSIONS.hrManage);
  const [settings, types, components, shifts] = await Promise.all([
    getHrSettings(ctx.supabase, ctx.hotel.id), listLeaveTypes(ctx.supabase, ctx.hotel.id),
    listPayComponents(ctx.supabase, ctx.hotel.id), listShifts(ctx.supabase, ctx.hotel.id),
  ]);
  const back = "/settings/hr";
  const edit = (k: string, id: string) => `${back}?${k}=${id}`;

  const leaveForm = (x?: HrLeaveTypeRow) => (
    <SimpleForm key={x?.id ?? "new"} columns={2} submitLabel="حفظ" errors={t.errors} action={saveLeaveTypeAction} onDone={back}
      initial={{ id: x?.id ?? "", name: x?.name ?? "", days_per_year: x ? String(Number(x.days_per_year)) : "0", paid: x?.paid ?? true,
        carry_over: x?.carry_over ?? false, encashable: x?.encashable ?? false, is_active: x?.is_active ?? true }}
      fields={[
        { name: "name", label: "الاسم" }, { name: "days_per_year", label: "الأيام في السنة، وصفر بلا حد", type: "number" },
        { name: "paid", label: "مدفوعة الأجر", checkbox: true }, { name: "carry_over", label: "يُرحّل المتبقي للسنة التالية", checkbox: true },
        { name: "encashable", label: "يُعوَّض رصيدها عند نهاية الخدمة", checkbox: true }, ...(x ? [{ name: "is_active", label: "مفعّلة", checkbox: true as const }] : []),
      ]} />
  );
  const componentForm = (x?: HrPayComponentRow) => (
    <SimpleForm key={x?.id ?? "new"} columns={2} submitLabel="حفظ" errors={t.errors} action={savePayComponentAction} onDone={back}
      initial={{ id: x?.id ?? "", name: x?.name ?? "", kind: x?.kind ?? "allowance", calc: x?.calc ?? "fixed", default_value: x ? String(Number(x.default_value)) : "0",
        insurable: x?.insurable ?? false, in_eos: x?.in_eos ?? false, is_active: x?.is_active ?? true }}
      fields={[
        { name: "name", label: "الاسم" },
        { name: "kind", label: "النوع", options: [{ id: "allowance", label: "بدل يُضاف للراتب" }, { id: "deduction", label: "خصم ثابت من الراتب" }] },
        { name: "calc", label: "طريقة الحساب", options: [{ id: "fixed", label: "مبلغ ثابت شهريًا" }, { id: "percent", label: "نسبة من الراتب الأساسي" }] },
        { name: "default_value", label: "القيمة الافتراضية لكل موظف", type: "number" },
        { name: "insurable", label: "يدخل في وعاء التأمينات", checkbox: true }, { name: "in_eos", label: "يدخل في أجر مكافأة نهاية الخدمة", checkbox: true },
        ...(x ? [{ name: "is_active", label: "مفعّل", checkbox: true as const }] : []),
      ]} />
  );
  const shiftForm = (x?: HrShiftRow) => (
    <SimpleForm key={x?.id ?? "new"} columns={2} submitLabel="حفظ" errors={t.errors} action={saveShiftAction} onDone={back}
      initial={{ id: x?.id ?? "", name: x?.name ?? "", start_time: hhmm(x?.start_time) || "08:00", end_time: hhmm(x?.end_time) || "16:00", is_active: x?.is_active ?? true }}
      fields={[
        { name: "name", label: "الاسم" }, { name: "start_time", label: "البداية", type: "time" }, { name: "end_time", label: "النهاية", type: "time" },
        ...(x ? [{ name: "is_active", label: "مفعّلة", checkbox: true as const }] : []),
      ]} />
  );
  const editLink = (k: string, id: string) => canEdit && <Link href={edit(k, id)} className="text-action">تعديل</Link>;
  const editing = { leave: types.find((x) => x.id === sp.leave), component: components.find((x) => x.id === sp.component), shift: shifts.find((x) => x.id === sp.shift) };

  return (
    <>
      <PageHeader title={t.nav.hrSettings} />
      <HrSettingsForm initial={settings} errors={t.errors} canEdit={canEdit} />

      <div className="mt-6 grid items-start gap-6 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-center justify-between"><CardTitle>أنواع الإجازات</CardTitle>
            {canEdit && <FormDialog label="نوع جديد" title="نوع إجازة جديد" variant="ghost" size="sm">{leaveForm()}</FormDialog>}</CardHeader>
          <Table>
            <TableHeader><TableRow><TableHead>النوع</TableHead><TableHead>الأيام</TableHead><TableHead>الخصائص</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {types.map((x) => (
                <TableRow key={x.id}>
                  <TableCell className="font-medium">{x.name}{!x.is_active && <Badge variant="secondary" className="ms-2">موقوف</Badge>}</TableCell>
                  <TableCell>{Number(x.days_per_year) ? <><span className="num">{Number(x.days_per_year)}</span> يوم</> : "بلا حد"}</TableCell>
                  <TableCell className="text-slate-600">{[x.paid ? "مدفوعة" : "بدون راتب", x.carry_over && "تُرحّل", x.encashable && "تُعوَّض"].filter(Boolean).join("، ")}</TableCell>
                  <TableCell className="text-end">{editLink("leave", x.id)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-center justify-between"><CardTitle>بنود الراتب</CardTitle>
            {canEdit && <FormDialog label="بند جديد" title="بند راتب جديد" variant="ghost" size="sm">{componentForm()}</FormDialog>}</CardHeader>
          <Table>
            <TableHeader><TableRow><TableHead>البند</TableHead><TableHead>الحساب</TableHead><TableHead>الخصائص</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {components.map((x) => (
                <TableRow key={x.id}>
                  <TableCell className="font-medium">{x.name}{!x.is_active && <Badge variant="secondary" className="ms-2">موقوف</Badge>}</TableCell>
                  <TableCell>{x.kind === "allowance" ? "بدل" : "خصم"}، {x.calc === "percent" ? <><span className="num">{Number(x.default_value)}</span>٪ من الأساسي</> : <>مبلغ <span className="num">{Number(x.default_value)}</span></>}</TableCell>
                  <TableCell className="text-slate-600">{[x.insurable && "تأمينات", x.in_eos && "نهاية الخدمة"].filter(Boolean).join("، ")}</TableCell>
                  <TableCell className="text-end">{editLink("component", x.id)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-center justify-between"><CardTitle>الورديات</CardTitle>
            {canEdit && <FormDialog label="وردية جديدة" title="وردية جديدة" variant="ghost" size="sm">{shiftForm()}</FormDialog>}</CardHeader>
          <Table>
            <TableBody>
              {shifts.map((x) => (
                <TableRow key={x.id}>
                  <TableCell className="font-medium">{x.name}{!x.is_active && <Badge variant="secondary" className="ms-2">موقوفة</Badge>}</TableCell>
                  <TableCell>من <span className="num">{hhmm(x.start_time)}</span> إلى <span className="num">{hhmm(x.end_time)}</span></TableCell>
                  <TableCell className="text-end">{editLink("shift", x.id)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>

      {editing.leave && <RouteDialog key={editing.leave.id} closeHref={back} title={`تعديل ${editing.leave.name}`}>{leaveForm(editing.leave)}</RouteDialog>}
      {editing.component && <RouteDialog key={editing.component.id} closeHref={back} title={`تعديل ${editing.component.name}`}>{componentForm(editing.component)}</RouteDialog>}
      {editing.shift && <RouteDialog key={editing.shift.id} closeHref={back} title={`تعديل ${editing.shift.name}`}>{shiftForm(editing.shift)}</RouteDialog>}
    </>
  );
}
