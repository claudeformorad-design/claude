import Link from "@/components/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { listVouchers } from "@/services/vouchers.service";
import { getI18n } from "@/i18n/server";
import { EmptyState } from "@/components/ui/empty-state";
import { Receipt } from "lucide-react";

export default async function VouchersPage({ searchParams }: { searchParams: Promise<{ type?: string; q?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.paymentsView);
  const { locale, t } = await getI18n();
  const sp = await searchParams;
  const vouchers = await listVouchers(ctx.supabase, ctx.hotel.id, sp);

  return (
    <>
      <PageHeader
        title={t.vouchers.title}
        description={t.vouchers.subtitle}
        actions={
          <>
            {ctx.can(PERMISSIONS.paymentsReceipt) && <Button asChild><Link href="/vouchers/new?type=receipt"><Plus />{t.vouchers.newReceipt}</Link></Button>}
            {ctx.can(PERMISSIONS.paymentsDisbursement) && <Button asChild variant="outline"><Link href="/vouchers/new?type=disbursement"><Plus />{t.vouchers.newDisbursement}</Link></Button>}
          </>
        }
      />
      <form className="mb-4 flex flex-wrap gap-2">
        <Input name="q" defaultValue={sp.q} placeholder={t.common.search} className="w-56" />
        <NativeSelect name="type" defaultValue={sp.type ?? ""} className="w-36">
          <option value="">{t.vouchers.type}</option>
          <option value="receipt">{t.vouchers.types.receipt}</option>
          <option value="disbursement">{t.vouchers.types.disbursement}</option>
        </NativeSelect>
        <Button type="submit" variant="outline">{t.common.apply}</Button>
      </form>
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.vouchers.voucherNumber}</TableHead>
              <TableHead>{t.common.date}</TableHead>
              <TableHead>{t.vouchers.type}</TableHead>
              <TableHead>{t.vouchers.party}</TableHead>
              <TableHead>{t.common.description}</TableHead>
              <TableHead className="text-end">{t.folio.amount}</TableHead>
              <TableHead>{t.common.status}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vouchers.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8">
                  <EmptyState
                    title="سجل سندات القبض والصرف فارغ"
                    description="لم يتم إصدار أي سند قبض أو صرف بعد. يمكنك تسجيل سند قبض جديد من النزلاء أو سند صرف للموردين."
                    actionHref="/vouchers/new?type=receipt"
                    actionLabel="إصدار سند قبض جديد"
                    icon={Receipt}
                  />
                </TableCell>
              </TableRow>
            )}
            {vouchers.map((v) => (
              <TableRow key={v.id} className={v.status === "voided" ? "opacity-60" : ""}>
                <TableCell><Link href={`/vouchers/${v.id}`} className="num font-medium text-primary hover:underline">{v.voucher_number}</Link></TableCell>
                <TableCell className="num">{v.payment_date}</TableCell>
                <TableCell><Badge variant={v.voucher_type === "receipt" ? "success" : "outline"}>{t.vouchers.types[v.voucher_type]}</Badge></TableCell>
                <TableCell>{v.party_name ?? "—"}</TableCell>
                <TableCell className="max-w-sm truncate">{v.description}</TableCell>
                <TableCell className="text-end"><Money value={v.amount} locale={locale} /></TableCell>
                <TableCell><Badge variant={v.status === "voided" ? "destructive" : "secondary"}>{t.vouchers.statuses[v.status]}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
