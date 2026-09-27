import Link from "@/components/link";
import { Settings2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { listOutlets, listPosItems, listPosOrders, posInHouse } from "@/services/operations.service";
import { listPaymentMethods } from "@/services/revenue-settings.service";
import { getI18n } from "@/i18n/server";
import { PosTerminal } from "./pos-terminal";

/** نقاط البيع: المطعم والكافيه وغيرها — البيع على غرفة النزيل أو بالدفع الفوري */
export default async function PosPage({ searchParams }: { searchParams: Promise<{ outlet?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.posSell);
  const { locale, t } = await getI18n();
  const sp = await searchParams;
  const today = todayInTimeZone(ctx.hotel.timezone);
  const [outlets, items, guests, methods, orders] = await Promise.all([
    listOutlets(ctx.supabase, ctx.hotel.id), listPosItems(ctx.supabase, ctx.hotel.id), posInHouse(ctx.supabase, ctx.hotel.id),
    listPaymentMethods(ctx.supabase, ctx.hotel.id), listPosOrders(ctx.supabase, ctx.hotel.id, `${today}T00:00:00`),
  ]);
  const active = outlets.filter((o) => o.is_active);
  const outlet = active.find((o) => o.id === sp.outlet) ?? active[0];
  const canSetup = ctx.can(PERMISSIONS.posManage);
  const outletName = new Map(outlets.map((o) => [o.id, o.name_ar]));

  return (
    <>
      <PageHeader title="نقاط البيع" description="المطعم والكافيه وخدمة الغرف: ترحيل على فوليو النزيل أو دفع فوري بفاتورة ضريبية"
        actions={canSetup && <Button asChild variant="outline"><Link href="/pos/setup"><Settings2 />إعداد النقاط والأصناف</Link></Button>} />
      {!outlet ? (
        <EmptyState title="لا توجد نقاط بيع بعد" description="أنشئ نقطة بيع مثل المطعم، وأضف أصنافها بأسعارها." actionHref={canSetup ? "/pos/setup" : undefined} actionLabel={canSetup ? "إعداد نقاط البيع" : undefined} />
      ) : (
        <>
          {active.length > 1 && (
            <div className="mb-4"><FilterTabs active={outlet.id} items={active.map((o) => ({ key: o.id, href: `/pos?outlet=${o.id}`, label: o.name_ar }))} /></div>
          )}
          <PosTerminal key={outlet.id} outletId={outlet.id} errors={t.errors} canViewInvoices={ctx.can(PERMISSIONS.invoicesView)}
            items={items.filter((i) => i.is_active && i.outlet_id === outlet.id).map((i) => ({ id: i.id, name: i.name_ar, category: i.category, price: Number(i.price) }))}
            guests={guests.map((g) => ({ reservation_id: g.reservation_id, label: `${g.room_number ?? ""} ${g.guest_name}` }))}
            methods={methods.filter((m) => m.is_active && m.kind !== "city_ledger" && !m.currency_code).map((m) => ({ id: m.id, label: m.name_ar }))} />
          <Card className="mt-6 overflow-hidden">
            <CardHeader><CardTitle>طلبات اليوم</CardTitle></CardHeader>
            <Table>
              <TableHeader><TableRow><TableHead>الطلب</TableHead><TableHead>النقطة</TableHead><TableHead>ملاحظة</TableHead><TableHead>التسوية</TableHead><TableHead className="text-end">الإجمالي</TableHead></TableRow></TableHeader>
              <TableBody>
                {orders.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-slate-500">لا طلبات اليوم</TableCell></TableRow>}
                {orders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="num whitespace-nowrap font-semibold">{o.order_number}</TableCell>
                    <TableCell>{outletName.get(o.outlet_id)}</TableCell>
                    <TableCell className="cell-fluid text-slate-600">{o.note}</TableCell>
                    <TableCell>{o.settle_mode === "room" ? <Badge variant="info">على الغرفة</Badge> : <Badge variant="success">مدفوع</Badge>}</TableCell>
                    <TableCell className="text-end"><Money value={o.total} locale={locale} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </>
  );
}
