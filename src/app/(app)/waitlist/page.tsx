import Link from "@/components/link";
import { BellRing, CheckCircle2, Hourglass, Plus, XCircle } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { EntityCell } from "@/components/ui/entity";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { addDays, dayLabel, nightsBetween } from "@/lib/pms/dates";
import { WAITLIST_STATUS } from "@/lib/pms/labels";
import { listRoomTypes, waitlistOverview } from "@/services/pms.service";
import { getI18n } from "@/i18n/server";
import { SimpleForm } from "../_assets/simple-form";
import { ActionButton } from "../_pms/action-button";
import { addWaitlistAction, cancelWaitlistAction, convertWaitlistAction } from "../_pms/actions";

type Tab = "waiting" | "ready" | "done";

/**
 * قائمة الانتظار: طلبات لم تتوفر لها غرفة. التوفر يُحسب لحظيًا؛ متى تحررت غرفة (إلغاء، عدم حضور،
 * تقصير إقامة، إعادة غرفة للخدمة) يظهر الطلب «متاح الآن» ويُنبَّه عليه في لوحة الاستقبال، ويتحول لحجز بنقرة.
 */
export default async function WaitlistPage({ searchParams }: {
  searchParams: Promise<{ tab?: string; new?: string; type?: string; arrival?: string; departure?: string }>;
}) {
  const ctx = await requireAppContext(PERMISSIONS.pmsView);
  const { t } = await getI18n();
  const sp = await searchParams;
  const today = todayInTimeZone(ctx.hotel.timezone);
  const [entries, types] = await Promise.all([waitlistOverview(ctx.supabase, ctx.hotel.id), listRoomTypes(ctx.supabase, ctx.hotel.id)]);
  const typeName = new Map(types.map((x) => [x.id, x.name_ar]));
  const nightlyTypes = types.filter((x) => x.is_active && x.booking_mode === "nightly");
  const canManage = ctx.can(PERMISSIONS.pmsManage);

  const waiting = entries.filter((e) => e.status === "waiting" && !e.is_expired);
  const ready = waiting.filter((e) => e.is_available);
  const done = entries.filter((e) => e.status !== "waiting" || e.is_expired);
  const tab: Tab = sp.tab === "ready" || sp.tab === "done" ? sp.tab : "waiting";
  const list = tab === "ready" ? ready : tab === "done" ? done : waiting;
  const showForm = canManage && (sp.new || waiting.length === 0);
  const arrival = sp.arrival && sp.arrival >= today ? sp.arrival : today;

  return (
    <>
      <PageHeader
        title={t.nav.waitlist}
        description="الطلبات التي لم تتوفر لها غرف. يتغير الطلب إلى «متاح الآن» تلقائيًا عند تحرر غرفة، ويتحول إلى حجز بنقرة."
        actions={canManage && !showForm && <Button asChild><Link href="/waitlist?new=1"><Plus />إضافة طلب</Link></Button>}
      />
      <StatGrid>
        <Stat icon={Hourglass} tone="ink" label="في الانتظار" value={<span className="num">{waiting.length}</span>} />
        <Stat icon={BellRing} tone="teal" label="أصبحت متاحة الآن" value={<span className="num">{ready.length}</span>} hint={ready.length ? "حوّلها لحجوزات" : undefined} />
        <Stat icon={CheckCircle2} tone="clay" label="تحولت لحجوزات" value={<span className="num">{entries.filter((e) => e.status === "converted").length}</span>} />
        <Stat icon={XCircle} tone="neutral" label="ملغاة أو منتهية" value={<span className="num">{entries.filter((e) => e.status === "cancelled" || e.is_expired).length}</span>} />
      </StatGrid>

      <div className={`grid items-start gap-6 ${showForm ? "xl:grid-cols-[minmax(0,1fr)_400px]" : ""}`}>
        <div className="space-y-4">
          <FilterTabs active={tab} items={[
            { key: "waiting", href: "/waitlist", label: "في الانتظار", count: waiting.length },
            { key: "ready", href: "/waitlist?tab=ready", label: "متاحة الآن", count: ready.length },
            { key: "done", href: "/waitlist?tab=done", label: "المنتهية" },
          ]} />
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow><TableHead>الطلب</TableHead><TableHead>النوع</TableHead><TableHead>الفترة</TableHead><TableHead>التوفر</TableHead><TableHead /></TableRow>
              </TableHeader>
              <TableBody>
                {list.length === 0 && (
                  <TableRow><TableCell colSpan={5}><EmptyState icon={Hourglass} title={tab === "ready" ? "لا توجد طلبات متاحة الآن" : "لا توجد طلبات"}
                    description="عند امتلاء نوع غرف في فترة ما، أضف الطلب هنا ليُنبَّه عليه عند تحرر غرفة." /></TableCell></TableRow>
                )}
                {list.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="cell-fluid"><EntityCell name={e.guest_name} sub={e.phone ?? e.notes ?? undefined} href={e.guest_id ? `/guests/${e.guest_id}` : undefined} /></TableCell>
                    <TableCell className="whitespace-nowrap">{typeName.get(e.room_type_id) ?? "—"}<span className="num block text-[13.5px] text-slate-500">{e.adults}{e.children ? ` + ${e.children}` : ""} نزيل</span></TableCell>
                    <TableCell className="whitespace-nowrap">{dayLabel(e.arrival_date)} ← {dayLabel(e.departure_date)}
                      <span className="num block text-[13.5px] text-slate-500">{nightsBetween(e.arrival_date, e.departure_date)} ليلة</span></TableCell>
                    <TableCell>
                      {e.status !== "waiting" ? <Badge variant={e.status === "converted" ? "success" : "secondary"}>{WAITLIST_STATUS[e.status]}</Badge>
                        : e.is_expired ? <Badge variant="secondary">انتهى موعده</Badge>
                        : e.is_available ? <Badge variant="success">متاح الآن</Badge> : <Badge variant="warning">لا تتوفر غرفة بعد</Badge>}
                    </TableCell>
                    <TableCell className="text-end">
                      {e.status === "converted" && e.reservation_id && <Button asChild variant="ghost" size="sm"><Link href={`/reservations/${e.reservation_id}`}>فتح الحجز</Link></Button>}
                      {canManage && e.status === "waiting" && !e.is_expired && (
                        <div className="flex justify-end gap-1">
                          {e.is_available && (
                            <ActionButton variant="default" label="تحويل لحجز" done="تم إنشاء الحجز" errors={t.errors}
                              run={convertWaitlistAction.bind(null, e.id)} href="/reservations/:id" />
                          )}
                          <ActionButton variant="ghost" label="إلغاء" done="أُلغي الطلب" errors={t.errors} confirmText="إلغاء طلب الانتظار؟" run={cancelWaitlistAction.bind(null, e.id)} />
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
        {showForm && (
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>طلب انتظار جديد</CardTitle>
              <CardDescription>للغرف الليلية. يمكن إضافة الطلب حتى لو كانت هناك غرف متاحة جزئيًا.</CardDescription>
            </CardHeader>
            <CardContent>
              {nightlyTypes.length === 0 ? <p className="text-slate-500">عرّف أنواع الغرف أولًا.</p> : (
                <SimpleForm columns={2} submitLabel="إضافة للانتظار" errors={t.errors} action={addWaitlistAction} onDone="/waitlist"
                  initial={{
                    guest_name: "", phone: "", room_type_id: nightlyTypes.some((x) => x.id === sp.type) ? sp.type! : nightlyTypes[0]!.id,
                    arrival_date: arrival, departure_date: sp.departure && sp.departure > arrival ? sp.departure : addDays(arrival, 1),
                    adults: "1", children: "0", notes: "",
                  }}
                  fields={[
                    { name: "guest_name", label: "اسم النزيل" }, { name: "phone", label: "الجوال", ltr: true },
                    { name: "room_type_id", label: "نوع الغرفة", options: nightlyTypes.map((x) => ({ id: x.id, label: x.name_ar })) },
                    { name: "adults", label: "بالغون", type: "number" },
                    { name: "arrival_date", label: "الوصول", type: "date" }, { name: "departure_date", label: "المغادرة", type: "date" },
                    { name: "children", label: "أطفال", type: "number" }, { name: "notes", label: "ملاحظات" },
                  ]} />
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
