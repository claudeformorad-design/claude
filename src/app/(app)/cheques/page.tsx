import { tr } from "@/i18n/tr";
import Link from "@/components/link";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { ZERO, toMoney } from "@/lib/accounting/money";
import { raise } from "@/services/errors";
import { getI18n } from "@/i18n/server";
import { AlarmClock, ArrowDownLeft, ArrowUpRight, Landmark } from "lucide-react";
import { ActionButton } from "../_pms/action-button";
import { bounceChequeAction } from "../_ledger/actions";
import { ClearChequeForm } from "../_ledger/forms";

const TABS = ["in", "out", "done"] as const;

/** الشيكات المؤجلة: الواردة تحت التحصيل والصادرة قبل صرفها، بمواعيد استحقاقها */
export default async function ChequesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.paymentsView);
  const { locale, t } = await getI18n();
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as (typeof TABS)[number]) : "in";
  const today = todayInTimeZone(ctx.hotel.timezone);
  const h = ctx.hotel.id;
  const [cheques, methods, waiting] = await Promise.all([
    ctx.supabase.from("cheques").select("id, direction, payment_id, cheque_number, bank_name, due_date, amount::text, party_name, status, settled_on, status_note")
      .eq("hotel_id", h).order("due_date"),
    ctx.supabase.from("payment_methods").select("id, code, name_ar, name_en, kind, is_active").eq("hotel_id", h),
    ctx.supabase.from("payments").select("id, voucher_number, voucher_type, payment_date, amount::text, party_name, payment_method_id")
      .eq("hotel_id", h).eq("status", "posted"),
  ]);
  raise(cheques.error); raise(methods.error); raise(waiting.error);
  const all = cheques.data ?? [];
  const chqMethods = new Set((methods.data ?? []).filter((m) => m.code === "CHQ_IN" || m.code === "CHQ_OUT").map((m) => m.id));
  const registered = new Set(all.map((c) => c.payment_id));
  const missing = (waiting.data ?? []).filter((p) => chqMethods.has(p.payment_method_id) && !registered.has(p.id));
  const banks = (methods.data ?? []).filter((m) => m.kind === "bank_transfer" && m.is_active).map((m) => ({ id: m.id, name: (locale === "en" && m.name_en) || m.name_ar }));
  const pendIn = all.filter((c) => c.direction === "in" && c.status === "pending");
  const pendOut = all.filter((c) => c.direction === "out" && c.status === "pending");
  const sum = (xs: typeof all) => xs.reduce((a, c) => a.plus(toMoney(c.amount)), ZERO);
  const overdue = [...pendIn, ...pendOut].filter((c) => c.due_date < today);
  const shown = tab === "in" ? pendIn : tab === "out" ? pendOut : all.filter((c) => c.status !== "pending");
  const canIn = ctx.can(PERMISSIONS.paymentsReceipt), canOut = ctx.can(PERMISSIONS.paymentsDisbursement), canVoid = ctx.can(PERMISSIONS.paymentsVoid);
  const status = (c: (typeof all)[number]) => c.status === "pending"
    ? (c.due_date < today ? <Badge variant="destructive">{tr("مستحق منذ {0}", c.due_date)}</Badge> : <Badge variant="info">{c.direction === "in" ? tr("تحت التحصيل") : tr("لم يُصرف")}</Badge>)
    : c.status === "cleared" ? <Badge variant="success">{c.direction === "in" ? tr("حُصّل") : tr("صُرف")}</Badge>
      : <Badge variant="destructive">{c.direction === "in" ? tr("مرتد") : tr("ملغى")}</Badge>;

  return (
    <>
      <PageHeader title={tr("الشيكات")} />
      <StatGrid>
        <Stat currency={ctx.hotel.base_currency} icon={ArrowDownLeft} tone="teal" label={tr("شيكات واردة تحت التحصيل")} value={<Money value={sum(pendIn)} locale={locale} />} hint={tr("{0} شيك", pendIn.length)} />
        <Stat currency={ctx.hotel.base_currency} icon={ArrowUpRight} tone="clay" label={tr("شيكات صادرة لم تُصرف")} value={<Money value={sum(pendOut)} locale={locale} />} hint={tr("{0} شيك", pendOut.length)} />
        <Stat icon={AlarmClock} tone="neutral" label={tr("مستحقة ولم تُسوَّ")} value={<span className="num">{overdue.length}</span>} />
        <Stat icon={Landmark} tone="ink" label={tr("سندات تنتظر بيانات الشيك")} value={<span className="num">{missing.length}</span>} />
      </StatGrid>

      {missing.length > 0 && (
        <Card className="space-y-2 p-4">
          <p className="font-semibold">{tr("سندات بشيك مؤجل بلا بيانات شيك")}</p>
          <ul className="space-y-1 text-[15px]">
            {missing.map((p) => (
              <li key={p.id}><Link href={`/vouchers/${p.id}`} className="num text-action">{p.voucher_number}</Link>{" "}{p.party_name ?? ""}{" "}<Money value={p.amount} locale={locale} /></li>
            ))}
          </ul>
        </Card>
      )}

      <FilterTabs items={[
        { key: "in", label: tr("واردة تحت التحصيل"), href: "/cheques?tab=in", count: pendIn.length },
        { key: "out", label: tr("صادرة لم تُصرف"), href: "/cheques?tab=out", count: pendOut.length },
        { key: "done", label: tr("المسوّاة"), href: "/cheques?tab=done" },
      ]} active={tab} />

      {shown.length === 0 ? (
        <EmptyState icon={Landmark} title={tr("لا شيكات هنا")}
          description={tr("أصدر سند قبض أو صرف بطريقة «شيك وارد مؤجل» أو «شيك صادر مؤجل»، ثم سجّل رقم الشيك من صفحة السند.")} />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader><TableRow>
              <TableHead>{tr("رقم الشيك")}</TableHead><TableHead>{tr("البنك")}</TableHead><TableHead>{tr("الطرف")}</TableHead>
              <TableHead>{tr("الاستحقاق")}</TableHead><TableHead className="text-end">{tr("المبلغ")}</TableHead><TableHead>{tr("الحالة")}</TableHead><TableHead />
            </TableRow></TableHeader>
            <TableBody>
              {shown.map((c) => (
                <TableRow key={c.id}>
                  <TableCell><Link href={`/vouchers/${c.payment_id}`} className="num text-action">{c.cheque_number}</Link></TableCell>
                  <TableCell>{c.bank_name ?? ""}</TableCell>
                  <TableCell>{c.party_name ?? ""}</TableCell>
                  <TableCell className="num">{c.due_date}</TableCell>
                  <TableCell className="text-end"><Money value={c.amount} locale={locale} /></TableCell>
                  <TableCell>{status(c)}{c.status_note && <p className="text-[13px] text-slate-500">{c.status_note}</p>}</TableCell>
                  <TableCell>
                    {c.status === "pending" && (
                      <div className="flex flex-wrap justify-end gap-2">
                        {(c.direction === "in" ? canIn : canOut) && banks.length > 0 && <ClearChequeForm chequeId={c.id} direction={c.direction} banks={banks} today={today} errors={t.errors} />}
                        {canVoid && <ActionButton run={bounceChequeAction.bind(null, c.id)} label={c.direction === "in" ? tr("ارتداد") : tr("إلغاء الشيك")}
                          done={c.direction === "in" ? tr("سُجّل ارتداد الشيك وأُلغي السند") : tr("أُلغي الشيك والسند")} errors={t.errors} variant="ghost"
                          reasonLabel={tr("السبب")} />}
                      </div>
                    )}
                    {c.status === "cleared" && c.direction === "in" && canVoid && (
                      <div className="flex justify-end"><ActionButton run={bounceChequeAction.bind(null, c.id)} label={tr("ارتداد")} done={tr("سُجّل ارتداد الشيك وأُلغي السند")}
                        errors={t.errors} variant="ghost" reasonLabel={tr("سبب الارتداد بعد التحصيل")} /></div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
