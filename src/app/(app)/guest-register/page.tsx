import { tr } from "@/i18n/tr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/layout/page-header";
import { Properties } from "@/components/ui/properties";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { dayLabel } from "@/lib/pms/dates";
import { ID_TYPES } from "@/lib/pms/labels";
import { guestRegister } from "@/services/pms.service";
import { PrintButton } from "../invoices/[id]/print-button";

/**
 * كشف النزلاء المقيمين لليلة معيّنة (للجهات الأمنية): الاسم والجنسية والهوية والغرفة وتواريخ الإقامة.
 * مهيأ للطباعة على A4؛ الصيغة قابلة للتعديل حسب نموذج الجهة المختصة.
 */
export default async function GuestRegisterPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.pmsReports);
  const sp = await searchParams;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayInTimeZone(ctx.hotel.timezone);
  const rows = await guestRegister(ctx.supabase, ctx.hotel.id, date);
  const persons = rows.reduce((a, r) => a + r.adults + r.children, 0);

  return (
    <>
      <PageHeader
        title={tr("كشف النزلاء")}
        actions={
          <div className="flex items-center gap-2">
            <form className="flex items-center gap-2 print:hidden">
              <Input type="date" name="date" defaultValue={date} aria-label={tr("التاريخ")} className="w-52" />
              <Button type="submit" variant="outline">{tr("عرض")}</Button>
            </form>
            <PrintButton label={tr("طباعة الكشف")} />
          </div>
        }
      />
      <Properties items={[
        [tr("الفندق"), ctx.hotel.name_ar],
        [tr("الليلة"), dayLabel(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })],
        [tr("الحجوزات"), <span key="r" className="num">{rows.length}</span>],
        [tr("الأشخاص"), <span key="p" className="num">{persons}</span>],
      ]} />
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead><TableHead>{tr("الغرفة")}</TableHead><TableHead>{tr("الاسم")}</TableHead><TableHead>{tr("الجنسية")}</TableHead>
              <TableHead>{tr("نوع الهوية")}</TableHead><TableHead>{tr("رقم الهوية")}</TableHead><TableHead>{tr("الجوال")}</TableHead>
              <TableHead>{tr("الأشخاص")}</TableHead><TableHead>{tr("الوصول")}</TableHead><TableHead>{tr("المغادرة")}</TableHead><TableHead>{tr("الجهة")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={11} className="py-10 text-center text-slate-500">{tr("لا نزلاء مقيمون في هذه الليلة")}</TableCell></TableRow>}
            {rows.map((r, i) => (
              <TableRow key={r.reservation_id}>
                <TableCell className="num">{i + 1}</TableCell>
                <TableCell className="num font-bold">{r.room_number ?? ""}</TableCell>
                <TableCell className="font-medium text-ink">{r.full_name}</TableCell>
                <TableCell>{r.nationality ?? ""}</TableCell>
                <TableCell>{r.id_type ? ID_TYPES[r.id_type] : <span className="text-urgent">{tr("غير مسجلة")}</span>}</TableCell>
                <TableCell className="num" dir="ltr">{r.id_number ?? ""}</TableCell>
                <TableCell className="num" dir="ltr">{r.phone ?? ""}</TableCell>
                <TableCell className="num">{r.adults}{r.children ? tr(" بالغ و{0} طفل", r.children) : ""}</TableCell>
                <TableCell className="num whitespace-nowrap">{r.arrival_date}</TableCell>
                <TableCell className="num whitespace-nowrap">{r.departure_date}</TableCell>
                <TableCell>{r.company ?? ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <p className="mt-6 hidden text-[13px] print:block">{tr("توقيع موظف الاستقبال: ____________________ &nbsp;&nbsp;&nbsp; الختم:")}</p>
    </>
  );
}
