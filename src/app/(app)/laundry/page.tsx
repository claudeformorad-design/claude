import { tr } from "@/i18n/tr";
import Link from "@/components/link";
import { CheckCircle2, Clock, Plus, Shirt, WashingMachine } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { formatDateTime } from "@/lib/accounting/fiscal";
import { LAUNDRY_NEXT, LAUNDRY_STATUS } from "@/lib/ops/labels";
import { baseDecimals, listLaundryOrders } from "@/services/guest-services.service";
import { getI18n } from "@/i18n/server";
import { ActionButton } from "../_pms/action-button";
import { updateLaundryOrderAction } from "../_services/actions";

type Tab = "active" | "ready" | "done";

/**
 * المغسلة: طلبات غسيل النزلاء المقيمين من الاستلام حتى التسليم. عند التسليم تُرحَّل قيمتها على فوليو الإقامة
 * تلقائيًا بندًا لكل صنف، والإلغاء متاح قبل التسليم فقط.
 */
export default async function LaundryPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.laundryManage);
  const { locale, t } = await getI18n();
  const sp = await searchParams;
  const [orders, dec] = await Promise.all([listLaundryOrders(ctx.supabase, ctx.hotel.id), baseDecimals(ctx.supabase, ctx.hotel.base_currency)]);
  const tab: Tab = sp.tab === "ready" || sp.tab === "done" ? sp.tab : "active";
  const active = orders.filter((o) => o.status === "received" || o.status === "in_process");
  const ready = orders.filter((o) => o.status === "ready");
  const done = orders.filter((o) => o.status === "delivered" || o.status === "cancelled");
  const shown = tab === "ready" ? ready : tab === "done" ? done : active;
  const tz = ctx.hotel.timezone;

  return (
    <>
      <PageHeader title={tr("المغسلة")} actions={
        <div className="flex gap-2">
          <Button asChild variant="outline"><Link href="/laundry/linen">{tr("المفروشات")}</Link></Button>
          <Button asChild variant="outline"><Link href="/laundry/setup">{tr("قائمة الأسعار")}</Link></Button>
          <Button asChild><Link href="/laundry/new"><Plus />{tr("طلب غسيل")}</Link></Button>
        </div>
      } />
      <StatGrid>
        <Stat icon={Clock} tone="ink" label={tr("مستلمة وفي المغسلة")} value={<span className="num">{active.length}</span>} />
        <Stat icon={Shirt} tone="clay" label={tr("جاهزة للتسليم")} value={<span className="num">{ready.length}</span>} />
        <Stat icon={WashingMachine} tone="neutral" label={tr("مستعجلة مفتوحة")} value={<span className="num">{[...active, ...ready].filter((o) => o.express).length}</span>} />
        <Stat icon={CheckCircle2} tone="teal" label={tr("سُلِّمت")} value={<span className="num">{orders.filter((o) => o.status === "delivered").length}</span>} />
      </StatGrid>

      <Card className="overflow-hidden">
        <CardHeader>
          <FilterTabs active={tab} items={[
            { key: "active", href: "/laundry", label: tr("قيد العمل"), count: active.length },
            { key: "ready", href: "/laundry?tab=ready", label: tr("جاهزة"), count: ready.length },
            { key: "done", href: "/laundry?tab=done", label: tr("المنتهية") },
          ]} />
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow><TableHead>{tr("الطلب")}</TableHead><TableHead>{tr("النزيل")}</TableHead><TableHead>{tr("الأصناف")}</TableHead><TableHead className="text-end">{tr("القيمة")}</TableHead><TableHead>{tr("الحالة")}</TableHead><TableHead /></TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 && (
              <TableRow><TableCell colSpan={6}><EmptyState icon={WashingMachine} title={tr("لا طلبات")} description={tr("طلبات غسيل النزلاء المقيمين، وتُرحَّل على فوليو الغرفة عند التسليم.")} /></TableCell></TableRow>
            )}
            {shown.map((o) => {
              const next = LAUNDRY_NEXT[o.status];
              return (
                <TableRow key={o.id}>
                  <TableCell className="whitespace-nowrap">
                    <span className="num font-medium text-ink">{o.order_number}</span>{o.express && <Badge variant="warning" className="ms-2">{tr("مستعجل")}</Badge>}
                    <span className="block num text-[14px] text-slate-500">{formatDateTime(o.received_at, tz)}</span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{o.guest_name}{o.room_number && <span className="block text-[14px] text-slate-500">{tr("غرفة {0}", o.room_number)}</span>}</TableCell>
                  <TableCell className="cell-fluid text-slate-700">
                    {o.lines.map((l) => tr("{0} × {1}", l.name, l.quantity)).join(tr("، "))}
                    {o.notes && <span className="block text-[14px] text-slate-500">{o.notes}</span>}
                  </TableCell>
                  <TableCell className="text-end"><Money value={o.total} locale={locale} decimals={dec} /></TableCell>
                  <TableCell><Badge variant={LAUNDRY_STATUS[o.status].variant}>{LAUNDRY_STATUS[o.status].label}</Badge></TableCell>
                  <TableCell className="text-end">
                    <div className="flex justify-end gap-1">
                      {next && (
                        <ActionButton variant={next.status === "delivered" ? "default" : "outline"} label={next.label}
                          done={next.status === "delivered" ? tr("سُلِّم الطلب ورُحِّل على الفوليو") : tr("تم تحديث الطلب")} errors={t.errors}
                          run={updateLaundryOrderAction.bind(null, o.id, next.status)} />
                      )}
                      {o.status === "delivered" && <Button asChild variant="ghost" size="sm"><Link href={`/folios/${o.folio_id}`}>{tr("الفوليو")}</Link></Button>}
                      {(o.status === "received" || o.status === "in_process" || o.status === "ready") && (
                        <ActionButton variant="ghost" label={tr("إلغاء")} done={tr("أُلغي الطلب")} errors={t.errors} confirmText={tr("إلغاء طلب الغسيل؟")}
                          run={updateLaundryOrderAction.bind(null, o.id, "cancelled")} />
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
