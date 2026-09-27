import Link from "@/components/link";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { ShiftReport } from "@/lib/supabase/database.types";

const TXN: Record<string, string> = {
  payment: "تحصيل", deposit: "عربون", refund: "إرجاع للنزيل", deposit_refund: "استرداد عربون",
};

/** ملخص الوردية لكل صندوق/طريقة دفع وحركاتها (يُعرض للوردية المفتوحة والمغلقة) */
export function ShiftReportView({ report, locale, timezone, canViewFolio }: { report: ShiftReport; locale: string; timezone: string; canViewFolio: boolean }) {
  const closed = report.shift.status === "closed";
  const time = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const baseTotal = report.methods.reduce((a, m) => a + Number(m.base_total), 0);
  return (
    <>
      <Card className="overflow-hidden">
        <CardHeader><CardTitle>الصناديق وطرق الدفع</CardTitle></CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الطريقة</TableHead><TableHead className="text-end">العهدة</TableHead><TableHead className="text-end">المقبوض</TableHead>
              <TableHead className="text-end">المدفوع</TableHead><TableHead className="text-end">المتوقع</TableHead>
              {closed && <><TableHead className="text-end">المعدود</TableHead><TableHead className="text-end">الفرق</TableHead></>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.methods.length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-slate-500">لا حركات بعد</TableCell></TableRow>}
            {report.methods.map((m) => (
              <TableRow key={m.payment_method_id}>
                <TableCell className="cell-fluid">
                  <span className="font-semibold text-ink">{m.name}</span>
                  {m.foreign && <Badge variant="info" className="ms-2">{m.currency_code}</Badge>}
                  <span className="num block text-[13.5px] text-slate-500">{m.count} حركة</span>
                </TableCell>
                <TableCell className="text-end"><Money value={m.float} locale={locale} blankZero /></TableCell>
                <TableCell className="text-end"><Money value={m.receipts} locale={locale} blankZero /></TableCell>
                <TableCell className="text-end"><Money value={m.payouts} locale={locale} blankZero /></TableCell>
                <TableCell className="text-end font-bold"><Money value={m.expected} locale={locale} /></TableCell>
                {closed && (
                  <>
                    <TableCell className="text-end"><Money value={m.counted ?? 0} locale={locale} /></TableCell>
                    <TableCell className={cn("text-end font-semibold", Number(m.difference) < 0 ? "text-urgent" : Number(m.difference) > 0 ? "text-success" : "")}>
                      <Money value={m.difference ?? 0} locale={locale} blankZero />
                    </TableCell>
                  </>
                )}
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={4}>صافي الوردية بالعملة الأساسية</TableCell>
              <TableCell className="text-end"><Money value={baseTotal} locale={locale} /></TableCell>
              {closed && <><TableCell /><TableCell /></>}
            </TableRow>
          </TableFooter>
        </Table>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader><CardTitle className="justify-between"><span>حركات الوردية</span><span className="num text-[15px] font-medium text-slate-500">{report.transactions.length}</span></CardTitle></CardHeader>
        <Table>
          <TableHeader>
            <TableRow><TableHead>الوقت</TableHead><TableHead>النزيل / الفوليو</TableHead><TableHead>النوع</TableHead><TableHead>الطريقة</TableHead><TableHead className="text-end">المبلغ</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {report.transactions.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-slate-500">لا حركات في هذه الوردية</TableCell></TableRow>}
            {report.transactions.map((x) => (
              <TableRow key={x.id}>
                <TableCell className="num whitespace-nowrap">{time(x.created_at)}</TableCell>
                <TableCell className="cell-fluid">
                  <span className="font-medium text-ink">{x.guest_name}</span>{x.room_number && <span className="num ms-2 text-slate-500">غرفة {x.room_number}</span>}
                  <span className="num block text-[13.5px] text-slate-500">
                    {canViewFolio ? <Link href={`/folios/${x.folio_id}`} className="text-action hover:underline">{x.folio_number}</Link> : x.folio_number}
                    {x.reference ? ` · ${x.reference}` : ""}
                  </span>
                </TableCell>
                <TableCell>{TXN[x.txn_type] ?? x.txn_type}{x.direction === -1 && <Badge variant="destructive" className="ms-2">إلغاء</Badge>}</TableCell>
                <TableCell>{x.method}</TableCell>
                <TableCell className="text-end whitespace-nowrap">
                  <Money value={x.amount * x.direction} locale={locale} className="font-semibold" />
                  {x.foreign_amount != null && <span className="num block text-[13.5px] text-slate-500">{(x.foreign_amount * x.direction).toLocaleString("en-US", { minimumFractionDigits: 2 })} {x.currency_code}</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
