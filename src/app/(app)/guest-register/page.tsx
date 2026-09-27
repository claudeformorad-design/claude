import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/layout/page-header";
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
        title="كشف النزلاء"
        description={`${ctx.hotel.name_ar}، ليلة ${dayLabel(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}، ${rows.length} حجز و${persons} شخص`}
        actions={
          <div className="flex items-center gap-2">
            <form className="flex items-center gap-2 print:hidden">
              <Input type="date" name="date" defaultValue={date} aria-label="التاريخ" className="w-52" />
              <Button type="submit" variant="outline">عرض</Button>
            </form>
            <PrintButton label="طباعة الكشف" />
          </div>
        }
      />
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead><TableHead>الغرفة</TableHead><TableHead>الاسم</TableHead><TableHead>الجنسية</TableHead>
              <TableHead>نوع الهوية</TableHead><TableHead>رقم الهوية</TableHead><TableHead>الجوال</TableHead>
              <TableHead>الأشخاص</TableHead><TableHead>الوصول</TableHead><TableHead>المغادرة</TableHead><TableHead>الجهة</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={11} className="py-10 text-center text-slate-500">لا نزلاء مقيمون في هذه الليلة</TableCell></TableRow>}
            {rows.map((r, i) => (
              <TableRow key={r.reservation_id}>
                <TableCell className="num">{i + 1}</TableCell>
                <TableCell className="num font-bold">{r.room_number ?? ""}</TableCell>
                <TableCell className="font-medium text-ink">{r.full_name}</TableCell>
                <TableCell>{r.nationality ?? ""}</TableCell>
                <TableCell>{r.id_type ? ID_TYPES[r.id_type] : <span className="text-urgent">غير مسجلة</span>}</TableCell>
                <TableCell className="num" dir="ltr">{r.id_number ?? ""}</TableCell>
                <TableCell className="num" dir="ltr">{r.phone ?? ""}</TableCell>
                <TableCell className="num">{r.adults}{r.children ? ` بالغ و${r.children} طفل` : ""}</TableCell>
                <TableCell className="num whitespace-nowrap">{r.arrival_date}</TableCell>
                <TableCell className="num whitespace-nowrap">{r.departure_date}</TableCell>
                <TableCell>{r.company ?? ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <p className="mt-6 hidden text-[13px] print:block">توقيع موظف الاستقبال: ____________________ &nbsp;&nbsp;&nbsp; الختم:</p>
    </>
  );
}
