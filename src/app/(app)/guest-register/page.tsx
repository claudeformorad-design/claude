import { tr } from "@/i18n/tr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/layout/page-header";
import { Properties } from "@/components/ui/properties";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { ExportButtons } from "@/components/reports/export-buttons";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import Link from "@/components/link";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { formatDateTime, todayInTimeZone } from "@/lib/accounting/fiscal";
import { dayLabel } from "@/lib/pms/dates";
import { ID_TYPES } from "@/lib/pms/labels";
import type { GuestListKind } from "@/lib/supabase/database.types";
import { guestMovements } from "@/services/pms.service";
import { getI18n } from "@/i18n/server";

/**
 * كشف النزلاء للجهات الأمنية لليوم المختار: المقيمون تلك الليلة، والواصلون، والمغادرون.
 * بالاسم والجنسية والهوية وتاريخ الميلاد، مع تمييز من لا هوية مسجلة له، وتصدير Excel وPDF وطباعة A4.
 */
export default async function GuestRegisterPage({ searchParams }: { searchParams: Promise<{ date?: string; list?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.pmsReports);
  const { t } = await getI18n();
  const sp = await searchParams;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayInTimeZone(ctx.hotel.timezone);
  const kind: GuestListKind = sp.list === "arrivals" || sp.list === "departures" ? sp.list : "in_house";
  const [inHouse, arrivals, departures] = await Promise.all([
    guestMovements(ctx.supabase, ctx.hotel.id, date, "in_house"),
    guestMovements(ctx.supabase, ctx.hotel.id, date, "arrivals"),
    guestMovements(ctx.supabase, ctx.hotel.id, date, "departures"),
  ]);
  const rows = kind === "arrivals" ? arrivals : kind === "departures" ? departures : inHouse;
  const persons = rows.reduce((a, r) => a + r.adults + r.children, 0);
  const missing = rows.filter((r) => !r.id_number);
  const title = kind === "arrivals" ? tr("كشف الواصلين") : kind === "departures" ? tr("كشف المغادرين") : tr("كشف النزلاء المقيمين");
  const href = (k: GuestListKind) => `/guest-register?date=${date}${k === "in_house" ? "" : `&list=${k}`}`;
  const time = (iso: string | null | undefined) => (iso ? formatDateTime(iso, ctx.hotel.timezone).slice(11, 16) : "");

  return (
    <>
      <PageHeader
        title={tr("كشف النزلاء")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <form className="flex items-center gap-2 print:hidden">
              <Input type="date" name="date" defaultValue={date} aria-label={tr("التاريخ")} className="w-52" />
              {kind !== "in_house" && <input type="hidden" name="list" value={kind} />}
              <Button type="submit" variant="outline">{tr("عرض")}</Button>
            </form>
            <ExportButtons report="police-register" query={`from=${date}&to=${date}&status=${kind}`} labels={{ excel: t.reports.exportExcel, pdf: t.reports.printPdf }} />
          </div>
        }
      />
      <FilterTabs className="mb-5 print:hidden" active={kind} items={[
        { key: "in_house", href: href("in_house"), label: tr("المقيمون الليلة"), count: inHouse.length },
        { key: "arrivals", href: href("arrivals"), label: tr("الواصلون اليوم"), count: arrivals.length },
        { key: "departures", href: href("departures"), label: tr("المغادرون اليوم"), count: departures.length },
      ]} />
      {missing.length > 0 && (
        <Alert variant="warning" className="mb-5 print:hidden">
          {tr("{0} بدون هوية مسجلة، أكمل بياناتهم قبل تسليم الكشف:", missing.length)}{" "}
          {missing.map((r, i) => <span key={r.reservation_id}>{i > 0 && "، "}<Link href={`/reservations/${r.reservation_id}`} className="font-semibold underline-offset-4 hover:underline">{r.full_name}</Link></span>)}
        </Alert>
      )}
      <Properties items={[
        [tr("الفندق"), ctx.hotel.name_ar],
        [tr("الكشف"), title],
        [kind === "in_house" ? tr("الليلة") : tr("اليوم"), dayLabel(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })],
        [tr("الحجوزات"), <span key="r" className="num">{rows.length}</span>],
        [tr("الأشخاص"), <span key="p" className="num">{persons}</span>],
      ]} />
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead><TableHead>{tr("الغرفة")}</TableHead><TableHead>{tr("الاسم")}</TableHead><TableHead>{tr("الجنسية")}</TableHead>
              <TableHead>{tr("نوع الهوية")}</TableHead><TableHead>{tr("رقم الهوية")}</TableHead><TableHead>{tr("تاريخ الميلاد")}</TableHead><TableHead>{tr("الجوال")}</TableHead>
              <TableHead>{tr("الأشخاص")}</TableHead><TableHead>{tr("الوصول")}</TableHead><TableHead>{tr("المغادرة")}</TableHead><TableHead>{tr("الجهة")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={12} className="py-10 text-center text-slate-500">
                {kind === "arrivals" ? tr("لا واصلين في هذا اليوم") : kind === "departures" ? tr("لا مغادرين في هذا اليوم") : tr("لا نزلاء مقيمون في هذه الليلة")}
              </TableCell></TableRow>
            )}
            {rows.map((r, i) => (
              <TableRow key={r.reservation_id}>
                <TableCell className="num">{i + 1}</TableCell>
                <TableCell className="num font-bold">{r.room_number ?? ""}</TableCell>
                <TableCell className="font-medium text-ink">{r.full_name}</TableCell>
                <TableCell>{r.nationality ?? ""}</TableCell>
                <TableCell>{r.id_type ? ID_TYPES[r.id_type] : <span className="text-urgent">{tr("غير مسجلة")}</span>}</TableCell>
                <TableCell className="num" dir="ltr">{r.id_number ?? ""}</TableCell>
                <TableCell className="num whitespace-nowrap">{r.date_of_birth ?? ""}</TableCell>
                <TableCell className="num" dir="ltr">{r.phone ?? ""}</TableCell>
                <TableCell className="num">{r.adults}{r.children ? tr(" بالغ و{0} طفل", r.children) : ""}</TableCell>
                <TableCell className="num whitespace-nowrap">{r.arrival_date}{kind === "arrivals" && <span className="block text-[13px] text-slate-500">{time(r.checked_in_at)}</span>}</TableCell>
                <TableCell className="num whitespace-nowrap">{r.departure_date}{kind === "departures" && <span className="block text-[13px] text-slate-500">{time(r.checked_out_at)}</span>}</TableCell>
                <TableCell>{r.company ?? ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <div className="mt-8 hidden grid-cols-2 gap-10 text-[13px] print:grid">
        <p>{tr("اسم موظف الاستقبال وتوقيعه")}<span className="mt-8 block border-b border-slate-400" /></p>
        <p>{tr("ختم الفندق")}<span className="mt-8 block border-b border-slate-400" /></p>
      </div>
    </>
  );
}
