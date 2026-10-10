import { tr } from "@/i18n/tr";
import Link from "@/components/link";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { toMoney } from "@/lib/accounting/money";
import { raise } from "@/services/errors";
import { getI18n } from "@/i18n/server";
import { ArrowLeftRight } from "lucide-react";
import { ActionButton } from "../_pms/action-button";
import { voidTransferAction } from "../_ledger/actions";
import { TransferForm } from "../_ledger/forms";

/** التحويل بين الصناديق والبنوك، وتبديل العملة بفرقه */
export default async function TransfersPage() {
  const ctx = await requireAppContext(PERMISSIONS.paymentsView);
  const { locale, t } = await getI18n();
  const h = ctx.hotel.id;
  const [methods, rows] = await Promise.all([
    ctx.supabase.from("payment_methods").select("id, name_ar, name_en, kind, currency_code, is_active").eq("hotel_id", h).order("code"),
    ctx.supabase.from("fund_transfers")
      .select("id, transfer_number, transfer_date, from_method_id, from_currency, from_amount::text, to_method_id, to_currency, to_amount::text, difference::text, description, status, void_reason, journal_entry_id")
      .eq("hotel_id", h).order("transfer_date", { ascending: false }).order("created_at", { ascending: false }).limit(200),
  ]);
  raise(methods.error); raise(rows.error);
  const base = ctx.hotel.base_currency;
  const name = (m: { name_ar: string; name_en: string | null }) => (locale === "en" && m.name_en) || m.name_ar;
  const byId = new Map((methods.data ?? []).map((m) => [m.id, m]));
  const usable = (methods.data ?? []).filter((m) => m.is_active && ["cash", "bank_transfer", "e_wallet"].includes(m.kind))
    .map((m) => ({ id: m.id, label: `${name(m)} ${m.currency_code ?? base}`, currency: m.currency_code ?? base, kind: m.kind }));
  const list = rows.data ?? [];
  const amount = (value: string, currency: string) => <span className="whitespace-nowrap"><Money value={value} locale={locale} />{" "}<span className="num text-[13px] text-slate-500">{currency}</span></span>;

  return (
    <>
      <PageHeader title={tr("التحويلات وتبديل العملة")} />
      <p className="max-w-3xl text-[15px] leading-relaxed text-slate-600">
        {tr("انقل المال بين الصناديق والبنوك: إيداع نقدية اليوم في البنك، أو تغذية صندوق الاستقبال من الخزينة. وإذا اختلفت العملة بين الطرفين يصبح السند تبديل عملة، ويُقيَّد فرق السعر تلقائيًا.")}
      </p>
      {ctx.can(PERMISSIONS.paymentsDisbursement) && usable.length >= 2 && (
        <Card className="space-y-3 p-4">
          <p className="font-semibold">{tr("سند تحويل جديد")}</p>
          <TransferForm methods={usable} base={base} today={todayInTimeZone(ctx.hotel.timezone)} errors={t.errors} />
        </Card>
      )}
      {list.length === 0 ? (
        <EmptyState icon={ArrowLeftRight} title={tr("لا تحويلات بعد")} description={tr("سجّل أول تحويل من الصندوق إلى البنك من النموذج أعلاه.")} />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader><TableRow>
              <TableHead>{tr("الرقم")}</TableHead><TableHead>{tr("التاريخ")}</TableHead><TableHead>{tr("من")}</TableHead><TableHead>{tr("إلى")}</TableHead>
              <TableHead className="text-end">{tr("فرق العملة")}</TableHead><TableHead>{tr("الحالة")}</TableHead><TableHead />
            </TableRow></TableHeader>
            <TableBody>
              {list.map((x) => {
                const fm = byId.get(x.from_method_id), tm = byId.get(x.to_method_id);
                const diff = toMoney(x.difference);
                return (
                  <TableRow key={x.id}>
                    <TableCell>
                      {x.journal_entry_id && ctx.can(PERMISSIONS.journalView)
                        ? <Link href={`/journal/${x.journal_entry_id}`} className="num text-action">{x.transfer_number}</Link>
                        : <span className="num">{x.transfer_number}</span>}
                      {x.description && <p className="text-[13px] text-slate-500">{x.description}</p>}
                    </TableCell>
                    <TableCell className="num">{x.transfer_date}</TableCell>
                    <TableCell>{fm ? name(fm) : ""}<div>{amount(x.from_amount, x.from_currency)}</div></TableCell>
                    <TableCell>{tm ? name(tm) : ""}<div>{amount(x.to_amount, x.to_currency)}</div></TableCell>
                    <TableCell className="text-end">
                      {diff.isZero() ? <span className="text-slate-400">{tr("لا فرق")}</span>
                        : <span className={diff.gt(0) ? "text-emerald-700" : "text-urgent"}>{diff.gt(0) ? tr("ربح") : tr("خسارة")}{" "}<Money value={diff.abs()} locale={locale} /></span>}
                    </TableCell>
                    <TableCell>
                      {x.status === "posted" ? <Badge variant="success">{tr("مرحّل")}</Badge> : <Badge variant="destructive">{tr("ملغى")}</Badge>}
                      {x.void_reason && <p className="text-[13px] text-slate-500">{x.void_reason}</p>}
                    </TableCell>
                    <TableCell>
                      {x.status === "posted" && ctx.can(PERMISSIONS.paymentsVoid) && (
                        <div className="flex justify-end"><ActionButton run={voidTransferAction.bind(null, x.id)} label={tr("إلغاء")} done={tr("أُلغي التحويل")}
                          errors={t.errors} variant="ghost" reasonLabel={tr("سبب الإلغاء")} /></div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
