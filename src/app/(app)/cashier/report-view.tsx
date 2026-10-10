import { tr } from "@/i18n/tr";
import Link from "@/components/link";
import { CodeTag } from "@/components/ui/code-text";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { ShiftReport } from "@/lib/supabase/database.types";

const TXN: Record<string, string> = {
  get payment() { return tr("تحصيل"); }, get deposit() { return tr("عربون"); }, get refund() { return tr("إرجاع للنزيل"); }, get deposit_refund() { return tr("استرداد عربون"); },
  get receipt() { return tr("سند قبض"); }, get disbursement() { return tr("سند صرف"); },
  get transfer_out() { return tr("تحويل صادر"); }, get transfer_in() { return tr("تحويل وارد"); },
};

/** ملخص الوردية لكل صندوق/طريقة دفع وحركاتها (يُعرض للوردية المفتوحة والمغلقة) */
export function ShiftReportView({ report, locale, timezone, canViewFolio }: { report: ShiftReport; locale: string; timezone: string; canViewFolio: boolean }) {
  const closed = report.shift.status === "closed";
  const time = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const baseTotal = report.methods.reduce((a, m) => a + Number(m.base_total), 0);
  return (
    <>
      <Card className="overflow-hidden">
        <CardHeader><CardTitle>{tr("الصناديق وطرق الدفع")}</CardTitle></CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tr("الطريقة")}</TableHead><TableHead className="text-end">{tr("الحركات")}</TableHead><TableHead className="text-end">{tr("العهدة")}</TableHead><TableHead className="text-end">{tr("المقبوض")}</TableHead>
              <TableHead className="text-end">{tr("المدفوع")}</TableHead><TableHead className="text-end">{tr("المتوقع")}</TableHead>
              {closed && <><TableHead className="text-end">{tr("المعدود")}</TableHead><TableHead className="text-end">{tr("الفرق")}</TableHead></>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.methods.length === 0 && <TableRow><TableCell colSpan={8} className="py-8 text-center text-slate-500">{tr("لا حركات بعد")}</TableCell></TableRow>}
            {report.methods.map((m) => (
              <TableRow key={m.payment_method_id}>
                <TableCell className="cell-fluid">
                  <span className="font-semibold text-ink">{m.name}</span>
                  {m.foreign && <Badge variant="info" className="ms-2">{m.currency_code}</Badge>}
                </TableCell>
                <TableCell className="num text-end">{m.count}</TableCell>
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
              <TableCell colSpan={5}>{tr("صافي الوردية بالعملة الأساسية")}</TableCell>
              <TableCell className="text-end"><Money value={baseTotal} locale={locale} /></TableCell>
              {closed && <><TableCell /><TableCell /></>}
            </TableRow>
          </TableFooter>
        </Table>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader><CardTitle className="justify-between"><span>{tr("حركات الوردية")}</span><span className="num font-medium text-slate-500">{report.transactions.length}</span></CardTitle></CardHeader>
        <Table>
          <TableHeader>
            <TableRow><TableHead>{tr("الوقت")}</TableHead><TableHead>{tr("البيان")}</TableHead><TableHead>{tr("المستند")}</TableHead><TableHead>{tr("النوع")}</TableHead><TableHead>{tr("الطريقة")}</TableHead><TableHead className="text-end">{tr("المبلغ")}</TableHead><TableHead className="text-end">{tr("بالعملة الأجنبية")}</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {report.transactions.length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-slate-500">{tr("لا حركات في هذه الوردية")}</TableCell></TableRow>}
            {report.transactions.map((x) => (
              <TableRow key={x.id}>
                <TableCell className="num whitespace-nowrap">{time(x.created_at)}</TableCell>
                <TableCell className="cell-fluid"><span className="font-medium text-ink">{x.guest_name}</span>{x.room_number && <span className="ms-2 text-slate-500">{tr("غرفة")}{" "}<span className="num">{x.room_number}</span></span>}</TableCell>
                <TableCell className="num whitespace-nowrap">
                  {x.source === "voucher" ? <Link href={`/vouchers/${x.id}`} className="text-action">{x.folio_number}</Link>
                    : x.source === "transfer" ? <Link href="/transfers" className="text-action">{x.folio_number}</Link>
                    : canViewFolio && x.folio_id ? <Link href={`/folios/${x.folio_id}`} className="text-action">{x.folio_number}</Link> : x.folio_number}
                  {x.reference && <CodeTag>{x.reference}</CodeTag>}
                </TableCell>
                <TableCell>{TXN[x.txn_type] ?? x.txn_type}{x.direction === -1 && <Badge variant="destructive" className="ms-2">{tr("إلغاء")}</Badge>}</TableCell>
                <TableCell>{x.method}</TableCell>
                <TableCell className="text-end whitespace-nowrap"><Money value={x.amount * x.direction} locale={locale} className="font-semibold" /></TableCell>
                <TableCell className="text-end whitespace-nowrap text-slate-600">{x.foreign_amount != null && <><span className="num">{(x.foreign_amount * x.direction).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span><CodeTag className="me-0">{x.currency_code}</CodeTag></>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
