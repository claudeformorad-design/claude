import { tr } from "@/i18n/tr";
import Link from "@/components/link";
import { BedSingle } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { FormDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { dayLabel } from "@/lib/pms/dates";
import { LINEN_KIND } from "@/lib/ops/labels";
import { listLinenBalances, listLinenMovements } from "@/services/guest-services.service";
import { getI18n } from "@/i18n/server";
import { SimpleForm } from "../../_assets/simple-form";
import { addLinenMovementAction, saveLinenTypeAction } from "../../_services/actions";

/**
 * مفروشات الفندق: الشراشف والمناشف وغيرها. الرصيد الكلي والموجود في المغسلة والمتاح، والحد المطلوب
 * للتشغيل؛ كل حركة (شراء، إرسال، استلام، تالف) تُسجَّل ولا تتجاوز ما هو متاح فعلًا.
 */
export default async function LinenPage() {
  const ctx = await requireAppContext(PERMISSIONS.laundryManage);
  const { t } = await getI18n();
  const today = todayInTimeZone(ctx.hotel.timezone);
  const [balances, moves] = await Promise.all([listLinenBalances(ctx.supabase, ctx.hotel.id), listLinenMovements(ctx.supabase, ctx.hotel.id)]);
  const active = balances.filter((b) => b.is_active);
  const name = new Map(balances.map((b) => [b.linen_type_id, b.name]));

  return (
    <>
      <PageHeader title={tr("المفروشات")} actions={
        <div className="flex gap-2">
          <Button asChild variant="outline"><Link href="/laundry">{tr("طلبات الغسيل")}</Link></Button>
          <FormDialog label={tr("نوع جديد")} title={tr("نوع مفروشات جديد")} variant="outline">
            <SimpleForm columns={2} submitLabel={tr("إضافة")} errors={t.errors} action={saveLinenTypeAction}
              initial={{ id: "", name: "", par_level: "0", is_active: true }}
              fields={[{ name: "name", label: tr("النوع") }, { name: "par_level", label: tr("الحد المطلوب للتشغيل"), type: "number" }]} />
          </FormDialog>
          {active.length > 0 && (
            <FormDialog label={tr("حركة")} title={tr("حركة مفروشات")}>
              <SimpleForm columns={2} submitLabel={tr("تسجيل")} errors={t.errors} action={addLinenMovementAction}
                initial={{ linen_type_id: active[0]!.linen_type_id, kind: "sent", quantity: "", movement_date: today, notes: "" }}
                fields={[
                  { name: "linen_type_id", label: tr("النوع"), options: active.map((b) => ({ id: b.linen_type_id, label: b.name })) },
                  { name: "kind", label: tr("الحركة"), options: Object.entries(LINEN_KIND).map(([id, label]) => ({ id, label })) },
                  { name: "quantity", label: tr("الكمية"), type: "number" },
                  { name: "movement_date", label: tr("التاريخ"), type: "date" },
                  { name: "notes", label: tr("ملاحظات") },
                ]} />
            </FormDialog>
          )}
        </div>
      } />
      <div className="grid gap-6">
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow><TableHead>{tr("النوع")}</TableHead><TableHead className="text-end">{tr("الإجمالي")}</TableHead><TableHead className="text-end">{tr("في المغسلة")}</TableHead><TableHead className="text-end">{tr("المتاح")}</TableHead><TableHead className="text-end">{tr("الحد المطلوب")}</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {balances.length === 0 && <TableRow><TableCell colSpan={5}><EmptyState icon={BedSingle} title={tr("لا أنواع مسجلة")} description={tr("أضف أنواع المفروشات ثم سجّل الشراء والإرسال والاستلام.")} /></TableCell></TableRow>}
              {balances.map((b) => {
                const available = b.total - b.at_laundry;
                return (
                  <TableRow key={b.linen_type_id}>
                    <TableCell className="cell-fluid font-medium text-ink">{b.name}{available < b.par_level && <Badge variant="warning" className="ms-2">{tr("أقل من الحد المطلوب")}</Badge>}</TableCell>
                    <TableCell className="text-end num">{b.total}</TableCell>
                    <TableCell className="text-end num">{b.at_laundry}</TableCell>
                    <TableCell className="text-end num font-semibold">{available}</TableCell>
                    <TableCell className="text-end num text-slate-600">{b.par_level}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
        {moves.length > 0 && (
          <Card className="overflow-hidden">
            <CardHeader><CardTitle>{tr("آخر الحركات")}</CardTitle></CardHeader>
            <Table>
              <TableHeader><TableRow><TableHead>{tr("التاريخ")}</TableHead><TableHead>{tr("النوع")}</TableHead><TableHead>{tr("الحركة")}</TableHead><TableHead className="text-end">{tr("الكمية")}</TableHead><TableHead>{tr("ملاحظات")}</TableHead></TableRow></TableHeader>
              <TableBody>
                {moves.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap text-slate-600">{dayLabel(m.movement_date)}</TableCell>
                    <TableCell className="whitespace-nowrap">{name.get(m.linen_type_id)}</TableCell>
                    <TableCell className="whitespace-nowrap">{LINEN_KIND[m.kind]}</TableCell>
                    <TableCell className="text-end num">{m.quantity}</TableCell>
                    <TableCell className="cell-fluid text-slate-600">{m.notes}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
    </>
  );
}
