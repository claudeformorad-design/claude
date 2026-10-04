import { tr } from "@/i18n/tr";
import Link from "@/components/link";
import { CalendarCheck, CalendarClock, PartyPopper, Plus, Wallet } from "lucide-react";
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
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { addDays, dayLabel, timeOf } from "@/lib/pms/dates";
import { EVENT_STATUS, EVENT_TYPE } from "@/lib/ops/labels";
import { listRooms } from "@/services/pms.service";
import { baseDecimals, listEvents } from "@/services/guest-services.service";
import { getI18n } from "@/i18n/server";

type Tab = "upcoming" | "past" | "cancelled";

/** القاعات والمناسبات: الأعراس والمؤتمرات والاجتماعات من العرض المبدئي حتى التنفيذ والفوترة */
export default async function EventsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.eventsView);
  const { locale } = await getI18n();
  const sp = await searchParams;
  const today = todayInTimeZone(ctx.hotel.timezone);
  const [events, rooms, dec] = await Promise.all([
    listEvents(ctx.supabase, ctx.hotel.id), listRooms(ctx.supabase, ctx.hotel.id), baseDecimals(ctx.supabase, ctx.hotel.base_currency),
  ]);
  const room = new Map(rooms.map((r) => [r.id, r.room_number]));
  const tab: Tab = sp.tab === "past" || sp.tab === "cancelled" ? sp.tab : "upcoming";
  const dateOf = (ts: string) => ts.slice(0, 10);
  const upcoming = events.filter((e) => (e.status === "tentative" || e.status === "confirmed")).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const past = events.filter((e) => e.status === "completed");
  const cancelled = events.filter((e) => e.status === "cancelled");
  const shown = tab === "past" ? past : tab === "cancelled" ? cancelled : upcoming;
  const month = today.slice(0, 7);
  const monthRevenue = past.filter((e) => dateOf(e.starts_at).slice(0, 7) === month).reduce((s, e) => s + Number(e.total), 0);

  return (
    <>
      <PageHeader title={tr("القاعات والمناسبات")} actions={ctx.can(PERMISSIONS.eventsManage) && <Button asChild><Link href="/events/new"><Plus />{tr("مناسبة جديدة")}</Link></Button>} />
      <StatGrid>
        <Stat icon={CalendarClock} tone="ink" label={tr("مبدئية")} value={<span className="num">{upcoming.filter((e) => e.status === "tentative").length}</span>} />
        <Stat icon={CalendarCheck} tone="teal" label={tr("مؤكدة قادمة")} value={<span className="num">{upcoming.filter((e) => e.status === "confirmed").length}</span>} />
        <Stat icon={PartyPopper} tone="clay" label={tr("هذا الأسبوع")} value={<span className="num">{upcoming.filter((e) => dateOf(e.starts_at) >= today && dateOf(e.starts_at) <= addDays(today, 6)).length}</span>} />
        <Stat icon={Wallet} tone="neutral" label={tr("إيراد المنفّذة هذا الشهر")} value={<Money value={monthRevenue} locale={locale} decimals={dec} />} />
      </StatGrid>

      <Card className="overflow-hidden">
        <CardHeader>
          <FilterTabs active={tab} items={[
            { key: "upcoming", href: "/events", label: tr("القادمة"), count: upcoming.length },
            { key: "past", href: "/events?tab=past", label: tr("المنفّذة") },
            { key: "cancelled", href: "/events?tab=cancelled", label: tr("الملغاة") },
          ]} />
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow><TableHead>{tr("المناسبة")}</TableHead><TableHead>{tr("الموعد")}</TableHead><TableHead>{tr("القاعة")}</TableHead><TableHead className="text-end">{tr("الحضور")}</TableHead><TableHead className="text-end">{tr("القيمة")}</TableHead><TableHead>{tr("الحالة")}</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 && (
              <TableRow><TableCell colSpan={6}><EmptyState icon={PartyPopper} title={tr("لا مناسبات")} description={tr("سجّل العرض للعميل مبدئيًا، وأكّده لتُحجز القاعة ويُفتح فوليو العربون.")} /></TableCell></TableRow>
            )}
            {shown.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="cell-fluid">
                  <Link href={`/events/${e.id}`} className="font-medium text-ink hover:underline">{e.title}</Link>
                  <span className="block text-[14px] text-slate-500"><span className="num">{e.event_number}</span>{tr("، ")}{EVENT_TYPE[e.event_type]}{tr("، ")}{e.contact_name}</span>
                </TableCell>
                <TableCell className="whitespace-nowrap">{dayLabel(dateOf(e.starts_at))}<span className="block num text-[14px] text-slate-500">{timeOf(e.starts_at.replace(" ", "T"))} {tr("إلى")} {timeOf(e.ends_at.replace(" ", "T"))}</span></TableCell>
                <TableCell className="whitespace-nowrap num font-semibold">{e.hall_room_id ? room.get(e.hall_room_id) : ""}</TableCell>
                <TableCell className="text-end num">{e.guests_count}</TableCell>
                <TableCell className="text-end"><Money value={e.total} locale={locale} decimals={dec} /></TableCell>
                <TableCell><Badge variant={EVENT_STATUS[e.status].variant}>{EVENT_STATUS[e.status].label}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

