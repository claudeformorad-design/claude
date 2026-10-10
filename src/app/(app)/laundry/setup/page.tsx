import { tr } from "@/i18n/tr";
import Link from "@/components/link";
import { Shirt } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormDialog, RouteDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { LAUNDRY_SERVICE } from "@/lib/ops/labels";
import { baseDecimals, listLaundryItems } from "@/services/guest-services.service";
import { getI18n } from "@/i18n/server";
import { type Field, SimpleForm } from "../../_assets/simple-form";
import { saveLaundryItemAction } from "../../_services/actions";

/** قائمة أسعار المغسلة: الصنف ونوع الخدمة وسعرها؛ الإيراد على رمز المغسلة */
export default async function LaundrySetupPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.laundryManage);
  const { locale, t } = await getI18n();
  const sp = await searchParams;
  const [items, dec] = await Promise.all([listLaundryItems(ctx.supabase, ctx.hotel.id), baseDecimals(ctx.supabase, ctx.hotel.base_currency)]);
  const edit = items.find((i) => i.id === sp.edit);
  const fields = (withActive: boolean): Field[] => [
    { name: "name", label: tr("الصنف") },
    { name: "service", label: tr("الخدمة"), options: Object.entries(LAUNDRY_SERVICE).map(([id, label]) => ({ id, label })) },
    { name: "price", label: tr("السعر"), type: "number" },
    ...(withActive ? [{ name: "is_active", label: tr("متاح"), checkbox: true as const }] : []),
  ];

  return (
    <>
      <PageHeader title={tr("أسعار المغسلة")} actions={
        <div className="flex gap-2">
          <Button asChild variant="outline"><Link href="/laundry">{tr("طلبات الغسيل")}</Link></Button>
          <FormDialog label={tr("صنف جديد")} title={tr("صنف جديد")}>
            <SimpleForm columns={2} submitLabel={tr("إضافة")} errors={t.errors} action={saveLaundryItemAction}
              initial={{ id: "", name: "", service: "wash_iron", price: "", is_active: true }} fields={fields(false)} />
          </FormDialog>
        </div>
      } />
      <Card className="overflow-hidden">
        <Table>
          <TableHeader><TableRow><TableHead>{tr("الصنف")}</TableHead><TableHead>{tr("الخدمة")}</TableHead><TableHead className="text-end">{tr("السعر")}</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {items.length === 0 && <TableRow><TableCell colSpan={4}><EmptyState icon={Shirt} title={tr("لا أصناف")} description={tr("أضف أصناف الغسيل وأسعارها: قميص، ثوب، بدلة، وغيرها.")} /></TableCell></TableRow>}
            {items.map((i) => (
              <TableRow key={i.id}>
                <TableCell className="cell-fluid font-medium text-ink">{i.name}{!i.is_active && <Badge variant="secondary" className="ms-2">{tr("موقوف")}</Badge>}</TableCell>
                <TableCell className="whitespace-nowrap">{LAUNDRY_SERVICE[i.service]}</TableCell>
                <TableCell className="text-end"><Money value={i.price} locale={locale} decimals={dec} /></TableCell>
                <TableCell className="text-end"><Button asChild variant="ghost" size="sm"><Link href={`/laundry/setup?edit=${i.id}`}>{tr("تعديل")}</Link></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      {edit && (
        <RouteDialog closeHref="/laundry/setup" title={tr("تعديل {0}", edit.name)}>
          <SimpleForm columns={2} submitLabel={tr("حفظ")} errors={t.errors} action={saveLaundryItemAction} onDone="/laundry/setup"
            initial={{ id: edit.id, name: edit.name, service: edit.service, price: String(Number(edit.price)), is_active: edit.is_active }} fields={fields(true)} />
        </RouteDialog>
      )}
    </>
  );
}
