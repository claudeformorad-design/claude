import { tr } from "@/i18n/tr";
import { notFound } from "next/navigation";
import Link from "@/components/link";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { PrintLink } from "@/components/print-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormDialog } from "@/components/ui/dialog";
import { Properties } from "@/components/ui/properties";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toMoney, ZERO } from "@/lib/accounting/money";
import { dayLabel, timeOf } from "@/lib/pms/dates";
import { EVENT_STATUS, EVENT_TYPE } from "@/lib/ops/labels";
import { listRooms } from "@/services/pms.service";
import { baseDecimals, getEvent } from "@/services/guest-services.service";
import { getI18n } from "@/i18n/server";
import { SimpleForm } from "../../_assets/simple-form";
import { ActionButton } from "../../_pms/action-button";
import { addEventTaskAction, cancelEventAction, completeEventAction, confirmEventAction } from "../../_services/actions";
import { TaskToggle } from "./task-toggle";

/**
 * المناسبة: العقد وبنوده، ودورة حياتها. التأكيد يحجز القاعة نهائيًا ويفتح فوليو يستقبل العربون،
 * والتنفيذ يرحّل البنود والخصم على الفوليو لتُسوّى وتصدر فاتورتها من شاشة الفوليو.
 */
export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireAppContext(PERMISSIONS.eventsView);
  const { locale, t } = await getI18n();
  const [d, rooms, dec] = await Promise.all([getEvent(ctx.supabase, ctx.hotel.id, id), listRooms(ctx.supabase, ctx.hotel.id), baseDecimals(ctx.supabase, ctx.hotel.base_currency)]);
  if (!d) notFound();
  const { event: e, items, tasks } = d;
  const canManage = ctx.can(PERMISSIONS.eventsManage);
  const open = e.status === "tentative" || e.status === "confirmed";
  const gross = items.reduce((s, i) => s.plus(toMoney(i.quantity).times(toMoney(i.unit_price))), ZERO);
  const net = gross.minus(toMoney(e.discount));
  const local = (ts: string) => ts.replace(" ", "T");
  const day = local(e.starts_at).slice(0, 10);

  return (
    <>
      <PageHeader title={e.title} actions={
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={EVENT_STATUS[e.status].variant}>{EVENT_STATUS[e.status].label}</Badge>
          <PrintLink href={`/print/event/${e.id}`} label={tr("طباعة العقد")} />
          {e.folio_id && ctx.can(PERMISSIONS.folioView) && <Button asChild variant="outline"><Link href={`/folios/${e.folio_id}`}>{tr("الفوليو والعربون")}</Link></Button>}
          {canManage && open && <Button asChild variant="outline"><Link href={`/events/${e.id}/edit`}>{tr("تعديل")}</Link></Button>}
          {canManage && e.status === "tentative" && (
            <ActionButton variant="default" label={tr("تأكيد المناسبة")} done={tr("تأكدت المناسبة وفُتح فوليو العربون")} errors={t.errors} run={confirmEventAction.bind(null, e.id)} />
          )}
          {canManage && e.status === "confirmed" && (
            <ActionButton variant="default" label={tr("تنفيذ وترحيل")} done={tr("رُحِّلت بنود المناسبة على الفوليو")} errors={t.errors}
              confirmText={tr("ترحيل بنود المناسبة وخصمها على الفوليو؟ لا يمكن تعديل العقد بعدها.")} run={completeEventAction.bind(null, e.id)} />
          )}
          {canManage && open && (
            <ActionButton variant="ghost" label={tr("إلغاء")} done={tr("أُلغيت المناسبة")} errors={t.errors} reasonLabel={tr("سبب الإلغاء")} run={cancelEventAction.bind(null, e.id)} />
          )}
        </div>
      } />

      <Properties items={[
        [tr("الرقم"), <span key="n" className="num">{e.event_number}</span>],
        [tr("النوع"), EVENT_TYPE[e.event_type]],
        [tr("الموعد"), <span key="d">{dayLabel(day)} <span className="num">{timeOf(local(e.starts_at))} {tr("إلى")} {timeOf(local(e.ends_at))}</span></span>],
        [tr("القاعة"), e.hall_room_id ? <span key="h" className="num">{rooms.find((r) => r.id === e.hall_room_id)?.room_number}</span> : null],
        [tr("صاحب المناسبة"), e.contact_name],
        [tr("الجوال"), e.contact_phone ? <span key="p" className="num" dir="ltr">{e.contact_phone}</span> : null],
        [tr("الحضور"), <span key="g" className="num">{e.guests_count}</span>],
        [tr("سبب الإلغاء"), e.cancel_reason],
      ]} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card className="overflow-hidden">
          <CardHeader><CardTitle>{tr("بنود العقد")}</CardTitle></CardHeader>
          <Table>
            <TableHeader><TableRow><TableHead>{tr("البند")}</TableHead><TableHead className="text-end">{tr("الكمية")}</TableHead><TableHead className="text-end">{tr("السعر")}</TableHead><TableHead className="text-end">{tr("المبلغ")}</TableHead></TableRow></TableHeader>
            <TableBody>
              {items.map((i) => (
                <TableRow key={i.line_no}>
                  <TableCell className="cell-fluid">{i.description}{i.per_person && <Badge variant="outline" className="ms-2">{tr("للفرد")}</Badge>}</TableCell>
                  <TableCell className="text-end num">{Number(i.quantity)}</TableCell>
                  <TableCell className="text-end"><Money value={i.unit_price} locale={locale} decimals={dec} /></TableCell>
                  <TableCell className="text-end"><Money value={toMoney(i.quantity).times(toMoney(i.unit_price))} locale={locale} decimals={dec} /></TableCell>
                </TableRow>
              ))}
              {!toMoney(e.discount).isZero() && (
                <TableRow><TableCell className="cell-fluid">{tr("الخصم")}</TableCell><TableCell /><TableCell />
                  <TableCell className="text-end"><Money value={toMoney(e.discount).negated()} locale={locale} decimals={dec} /></TableCell></TableRow>
              )}
              <TableRow><TableCell className="cell-fluid font-semibold">{tr("الصافي")}</TableCell><TableCell /><TableCell />
                <TableCell className="text-end font-semibold"><Money value={net} locale={locale} decimals={dec} /></TableCell></TableRow>
            </TableBody>
          </Table>
          {e.terms && <CardContent className="border-t border-line pt-4"><p className="text-[14px] text-slate-500">{tr("شروط العقد")}</p><p className="whitespace-pre-line">{e.terms}</p></CardContent>}
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>{tr("مهام التجهيز")}</CardTitle>
            {canManage && open && (
              <FormDialog label={tr("مهمة")} title={tr("مهمة تجهيز")} variant="outline" size="sm">
                <SimpleForm columns={2} submitLabel={tr("إضافة")} errors={t.errors} action={addEventTaskAction.bind(null, e.id)}
                  initial={{ task: "", owner: "", due_at: `${day}T12:00` }}
                  fields={[{ name: "task", label: tr("المهمة") }, { name: "owner", label: tr("المسؤول") }, { name: "due_at", label: tr("الموعد"), type: "datetime-local" }]} />
              </FormDialog>
            )}
          </CardHeader>
          <div className="divide-y divide-line">
            {tasks.length === 0 && <p className="px-6 py-6 text-slate-500">{tr("لا مهام بعد: الكوشة، الإضاءة، الصوت، الضيافة وغيرها.")}</p>}
            {tasks.map((k) => (
              <div key={k.id} className="flex items-start gap-3 px-6 py-3">
                <TaskToggle eventId={e.id} taskId={k.id} done={k.done} label={k.task} disabled={!canManage} errors={t.errors} />
                <div className="min-w-0 flex-1">
                  <p className={k.done ? "text-slate-500 line-through" : "font-medium text-ink"}>{k.task}</p>
                  <p className="text-[14px] text-slate-500"><span className="num">{dayLabel(local(k.due_at).slice(0, 10))} {timeOf(local(k.due_at))}</span>{k.owner ? tr("، {0}", k.owner) : ""}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
