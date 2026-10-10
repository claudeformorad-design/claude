import { localNameOf } from "@/lib/local-name";
import { tr } from "@/i18n/tr";
import { ExpandableRow, ExpandMark } from "@/components/ui/expandable-row";
import Link from "@/components/link";
import { CalendarCheck, CalendarDays, Hourglass, Plus, Repeat, Search, Users, Wallet } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Properties } from "@/components/ui/properties";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { Input } from "@/components/ui/input";
import { Pager, pageSlice } from "@/components/ui/pager";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { ZERO, toMoney } from "@/lib/accounting/money";
import { RESERVATION_STATUS } from "@/lib/pms/labels";
import { nightsBetween, nightsText, shortDate, timeRange } from "@/lib/pms/dates";
import { listReservations, type ReservationListItem } from "@/services/pms.service";
import { getI18n } from "@/i18n/server";

type Tab = "upcoming" | "arrivals" | "inhouse" | "tentative" | "overdue" | "closed" | "all";

export default async function ReservationsPage({ searchParams }: {
  searchParams: Promise<{ tab?: string; q?: string; page?: string; group?: string; series?: string }>;
}) {
  const ctx = await requireAppContext(PERMISSIONS.pmsView);
  const { locale, t } = await getI18n();
  const sp = await searchParams;
  const today = todayInTimeZone(ctx.hotel.timezone);
  const all = await listReservations(ctx.supabase, ctx.hotel.id);
  const scoped = all.filter((r) => (!sp.group || r.group_id === sp.group) && (!sp.series || r.series_id === sp.series));

  const is = {
    upcoming: (r: ReservationListItem) => (r.status === "confirmed" || r.status === "tentative") && r.departure_date >= today,
    arrivals: (r: ReservationListItem) => r.arrival_date === today && (r.status === "confirmed" || r.status === "tentative"),
    inhouse: (r: ReservationListItem) => r.status === "checked_in",
    tentative: (r: ReservationListItem) => r.status === "tentative",
    // تجاوز موعده: مقيم بعد تاريخ مغادرته، أو مؤكد لم يصل وقد فات وصوله
    overdue: (r: ReservationListItem) => (r.status === "checked_in" && r.departure_date < today)
      || ((r.status === "confirmed" || r.status === "tentative") && r.arrival_date < today),
    closed: (r: ReservationListItem) => ["cancelled", "no_show", "checked_out"].includes(r.status),
    all: () => true,
  } satisfies Record<Tab, (r: ReservationListItem) => boolean>;
  const tab: Tab = (Object.keys(is) as Tab[]).find((k) => k === sp.tab) ?? (sp.group || sp.series ? "all" : "upcoming");
  const q = sp.q?.trim();
  const list = scoped
    .filter(is[tab])
    .filter((r) => !q || r.confirmation_number.includes(q.toUpperCase()) || r.guest?.full_name.includes(q) || r.guest?.phone?.includes(q) || r.room?.room_number === q);
  // القادمة بالأقرب وصولًا، والبقية بالأحدث
  const sorted = tab === "upcoming" || tab === "arrivals" || tab === "tentative" ? list : [...list].reverse();
  const shown = pageSlice(sorted, sp.page);
  const upcoming = scoped.filter(is.upcoming);
  const qs = (x: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ group: sp.group, series: sp.series, q, ...x }).filter(([, v]) => v) as [string, string][]);
    return `/reservations${p.size ? `?${p}` : ""}`;
  };
  const canManage = ctx.can(PERMISSIONS.pmsManage);

  return (
    <>
      <PageHeader
        title={sp.group ? tr("حجوزات المجموعة") : sp.series ? tr("الحجز المتكرر") : t.nav.reservations}
        actions={canManage && (
          <>
            <Button asChild variant="outline"><Link href="/reservations/new?kind=group"><Users />{tr("مجموعة")}</Link></Button>
            <Button asChild variant="outline"><Link href="/reservations/new?kind=series"><Repeat />{tr("متكرر")}</Link></Button>
            <Button asChild><Link href="/reservations/new"><Plus />{tr("حجز جديد")}</Link></Button>
          </>
        )}
      />
      {(sp.group || sp.series) && (
        <Properties items={[
          [sp.group ? tr("المجموعة") : tr("السلسلة"), tr("{0} حجز مرتبط", scoped.length)],
          [tr("العودة"), <Link key="all" href="/reservations" className="text-action">{tr("كل الحجوزات")}</Link>],
        ]} />
      )}
      <StatGrid>
        <Stat icon={CalendarDays} tone="ink" label={tr("حجوزات قادمة وقائمة")} value={<span className="num">{upcoming.length}</span>} />
        <Stat icon={CalendarCheck} tone="teal" label={tr("وصول اليوم")} value={<span className="num">{scoped.filter(is.arrivals).length}</span>} />
        <Stat icon={Hourglass} tone="clay" label={tr("مبدئية بانتظار التأكيد")} value={<span className="num">{scoped.filter(is.tentative).length}</span>} />
        <Stat currency={ctx.hotel.base_currency} icon={Wallet} tone="neutral" label={tr("قيمة الحجوزات القادمة")} value={<Money value={upcoming.reduce((a, r) => a.plus(toMoney(r.total_amount)), ZERO)} locale={locale} />} />
      </StatGrid>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <FilterTabs active={tab} items={[
          { key: "upcoming", href: qs({}), label: tr("القادمة"), count: upcoming.length },
          { key: "arrivals", href: qs({ tab: "arrivals" }), label: tr("وصول اليوم"), count: scoped.filter(is.arrivals).length },
          { key: "inhouse", href: qs({ tab: "inhouse" }), label: tr("المقيمون"), count: scoped.filter(is.inhouse).length },
          { key: "tentative", href: qs({ tab: "tentative" }), label: tr("المبدئية"), count: scoped.filter(is.tentative).length },
          { key: "overdue", href: qs({ tab: "overdue" }), label: tr("تجاوزت موعدها"), count: scoped.filter(is.overdue).length },
          { key: "closed", href: qs({ tab: "closed" }), label: tr("المنتهية والملغاة") },
          { key: "all", href: qs({ tab: "all" }), label: tr("الكل"), count: scoped.length },
        ]} />
        <form className="flex gap-2" action="/reservations">
          {sp.group && <input type="hidden" name="group" value={sp.group} />}
          {sp.series && <input type="hidden" name="series" value={sp.series} />}
          {tab !== "upcoming" && <input type="hidden" name="tab" value={tab} />}
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-[18px] -translate-y-1/2 text-slate-400" />
            <Input name="q" defaultValue={q ?? ""} placeholder={tr("رقم الحجز أو النزيل أو الغرفة")} className="w-72 ps-10" />
          </div>
        </form>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tr("رقم الحجز")}</TableHead><TableHead>{tr("النزيل")}</TableHead><TableHead>{tr("الغرفة")}</TableHead><TableHead>{tr("النوع")}</TableHead>
              <TableHead>{tr("الإقامة")}</TableHead><TableHead>{tr("المدة")}</TableHead><TableHead>{tr("الحالة")}</TableHead><TableHead className="text-end">{tr("المبلغ")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.length === 0 && (
              <TableRow><TableCell colSpan={8}><EmptyState icon={CalendarDays} title={q ? tr("لا توجد نتائج") : tr("لا توجد حجوزات هنا")}
                description={tr("الحجوزات الجديدة تظهر هنا مع حالتها ومبلغها المثبّت.")} actionHref={canManage ? "/reservations/new" : undefined} actionLabel={tr("حجز جديد")} /></TableCell></TableRow>
            )}
            {shown.rows.map((r) => (
              <ExpandableRow kind="reservation" id={r.id} colSpan={8} key={r.id} className={r.status === "cancelled" || r.status === "no_show" ? "opacity-60" : ""}>
                <TableCell className="whitespace-nowrap"><ExpandMark /><Link href={`/reservations/${r.id}`} className="num font-semibold text-ink">{r.confirmation_number}</Link></TableCell>
                <TableCell className="cell-fluid"><Link href={`/guests/${r.guest_id}`} className="block truncate font-medium text-ink transition-colors hover:text-action">{r.guest?.full_name}</Link></TableCell>
                <TableCell className="whitespace-nowrap">{r.room ? <span className="num font-semibold">{r.room.room_number}</span> : <span className="text-slate-400">{tr("غير مخصصة")}</span>}</TableCell>
                <TableCell className="whitespace-nowrap text-slate-600">{localNameOf(r.room_type)}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {r.booking_mode === "hourly" ? <span className="num">{shortDate(r.arrival_date)}</span> : <>{tr("من")}{" "}<span className="num">{shortDate(r.arrival_date)}</span>{" "}{tr("إلى")}{" "}<span className="num">{shortDate(r.departure_date)}</span></>}
                </TableCell>
                <TableCell className="whitespace-nowrap text-slate-600">{r.booking_mode === "hourly" ? timeRange(r.starts_at, r.ends_at) : nightsText(nightsBetween(r.arrival_date, r.departure_date))}</TableCell>
                <TableCell><Badge variant={RESERVATION_STATUS[r.status].variant}>{RESERVATION_STATUS[r.status].label}</Badge></TableCell>
                <TableCell className="text-end font-semibold"><Money value={r.total_amount} locale={locale} /></TableCell>
              </ExpandableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <Pager page={shown.page} pages={shown.pages} total={list.length} basePath="/reservations" params={{ tab: tab === "upcoming" ? undefined : tab, q, group: sp.group, series: sp.series }} />
    </>
  );
}
