import { tr } from "@/i18n/tr";
import Link from "@/components/link";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { sumMoney } from "@/lib/accounting/money";
import { RESERVATION_SOURCE } from "@/lib/pms/labels";
import type { ReservationSource } from "@/lib/supabase/database.types";
import { raise } from "@/services/errors";
import { getI18n } from "@/i18n/server";
import { BadgePercent, CalendarCheck, Hourglass } from "lucide-react";
import { ActionButton } from "../_pms/action-button";
import { reverseCommissionAction } from "../_ledger/actions";
import { CommissionRateForm, PostCommissionsButton } from "../_ledger/forms";

/** عمولات وكلاء الحجز: النسب لكل مصدر، والعمولات المستحقة بعد المغادرة، وسجل المرحّل منها */
export default async function CommissionsPage() {
  const ctx = await requireAppContext(PERMISSIONS.commissionsManage);
  const { locale, t } = await getI18n();
  const h = ctx.hotel.id;
  const [rates, pending, posted] = await Promise.all([
    ctx.supabase.from("channel_commission_rates").select("source, rate::text").eq("hotel_id", h),
    ctx.supabase.rpc("pending_channel_commissions", { p_hotel_id: h }),
    ctx.supabase.from("reservation_commissions")
      .select("id, reservation_id, confirmation_number, guest_name, source, base_amount::text, rate::text, amount::text, posting_date, status, reversal_reason, journal_entry_id")
      .eq("hotel_id", h).order("posting_date", { ascending: false }).order("created_at", { ascending: false }).limit(200),
  ]);
  raise(rates.error); raise(pending.error); raise(posted.error);
  const rateBy = new Map((rates.data ?? []).map((r) => [r.source, String(Number(r.rate))]));
  const sources = (Object.keys(RESERVATION_SOURCE) as ReservationSource[]).map((s) => ({ value: s, label: RESERVATION_SOURCE[s], rate: rateBy.get(s) ?? "" }));
  const due = pending.data ?? [];
  const month = todayInTimeZone(ctx.hotel.timezone).slice(0, 7);
  const thisMonth = (posted.data ?? []).filter((c) => c.status === "posted" && c.posting_date.startsWith(month));
  const pct = (v: string) => `${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;

  return (
    <>
      <PageHeader title={tr("عمولات وكلاء الحجز")} actions={<PostCommissionsButton count={due.length} errors={t.errors} />} />
      <p className="max-w-3xl text-[15px] leading-relaxed text-slate-600">
        {tr("حدد نسبة العمولة لكل مصدر حجز. بعد مغادرة النزيل تظهر العمولة هنا محسوبة على صافي إيراد الليالي بلا ضريبة. الترحيل يقيّد العمولة مصروفًا ويثبتها مستحقة للوكيل، وتسددها بسند صرف على حساب «عمولات وكلاء الحجز المستحقة».")}
      </p>
      <StatGrid>
        <Stat currency={ctx.hotel.base_currency} icon={Hourglass} tone="clay" label={tr("عمولات مستحقة لم تُرحَّل")}
          value={<Money value={sumMoney(due.map((d) => String(d.amount)))} locale={locale} />} hint={tr("{0} حجز", due.length)} />
        <Stat currency={ctx.hotel.base_currency} icon={CalendarCheck} tone="teal" label={tr("المرحّل هذا الشهر")}
          value={<Money value={sumMoney(thisMonth.map((c) => c.amount))} locale={locale} />} hint={tr("{0} حجز", thisMonth.length)} />
        <Stat icon={BadgePercent} tone="ink" label={tr("مصادر عليها عمولة")} value={<span className="num">{rateBy.size}</span>} />
      </StatGrid>

      <Card className="space-y-3 p-4">
        <p className="font-semibold">{tr("نسب العمولة")}</p>
        <CommissionRateForm sources={sources} errors={t.errors} />
        {rateBy.size > 0 && (
          <div className="flex flex-wrap gap-2">
            {sources.filter((s) => s.rate).map((s) => <Badge key={s.value} variant="secondary">{s.label} <span className="num ms-1">{pct(s.rate)}</span></Badge>)}
          </div>
        )}
      </Card>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{tr("عمولات مستحقة")}</h2>
        {due.length === 0 ? (
          <EmptyState icon={BadgePercent} title={tr("لا عمولات مستحقة")}
            description={rateBy.size === 0 ? tr("ابدأ بتحديد نسبة العمولة لمصادر الحجز مثل Booking.com.") : tr("تظهر هنا الحجوزات التي غادر نزلاؤها من مصدر له نسبة عمولة.")} />
        ) : (
          <Card className="overflow-hidden">
            <Table>
              <TableHeader><TableRow>
                <TableHead>{tr("الحجز")}</TableHead><TableHead>{tr("النزيل")}</TableHead><TableHead>{tr("المصدر")}</TableHead><TableHead>{tr("المغادرة")}</TableHead>
                <TableHead className="text-end">{tr("صافي الإيراد")}</TableHead><TableHead className="text-end">{tr("النسبة")}</TableHead>
                <TableHead className="text-end">{tr("العمولة")}</TableHead><TableHead />
              </TableRow></TableHeader>
              <TableBody>
                {due.map((d) => (
                  <TableRow key={d.reservation_id}>
                    <TableCell><Link href={`/reservations/${d.reservation_id}`} className="num text-action">{d.confirmation_number}</Link></TableCell>
                    <TableCell>{d.guest_name ?? ""}</TableCell>
                    <TableCell>{RESERVATION_SOURCE[d.source]}</TableCell>
                    <TableCell className="num">{d.departure_date}</TableCell>
                    <TableCell className="text-end"><Money value={String(d.base_amount)} locale={locale} /></TableCell>
                    <TableCell className="num text-end">{pct(String(d.rate))}</TableCell>
                    <TableCell className="text-end"><Money value={String(d.amount)} locale={locale} /></TableCell>
                    <TableCell><div className="flex justify-end"><PostCommissionsButton count={1} reservationId={d.reservation_id} errors={t.errors} /></div></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </section>

      {(posted.data ?? []).length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">{tr("العمولات المرحّلة")}</h2>
          <Card className="overflow-hidden">
            <Table>
              <TableHeader><TableRow>
                <TableHead>{tr("التاريخ")}</TableHead><TableHead>{tr("الحجز")}</TableHead><TableHead>{tr("المصدر")}</TableHead>
                <TableHead className="text-end">{tr("العمولة")}</TableHead><TableHead>{tr("الحالة")}</TableHead><TableHead />
              </TableRow></TableHeader>
              <TableBody>
                {(posted.data ?? []).map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="num">{c.posting_date}</TableCell>
                    <TableCell>
                      {c.journal_entry_id && ctx.can(PERMISSIONS.journalView)
                        ? <Link href={`/journal/${c.journal_entry_id}`} className="num text-action">{c.confirmation_number}</Link>
                        : <span className="num">{c.confirmation_number}</span>}
                      {c.guest_name && <span className="ms-2 text-slate-500">{c.guest_name}</span>}
                    </TableCell>
                    <TableCell>{RESERVATION_SOURCE[c.source]} <span className="num text-slate-500">{pct(c.rate)}</span></TableCell>
                    <TableCell className="text-end"><Money value={c.amount} locale={locale} /></TableCell>
                    <TableCell>
                      {c.status === "posted" ? <Badge variant="success">{tr("مرحّلة")}</Badge> : <Badge variant="destructive">{tr("معكوسة")}</Badge>}
                      {c.reversal_reason && <p className="text-[13px] text-slate-500">{c.reversal_reason}</p>}
                    </TableCell>
                    <TableCell>
                      {c.status === "posted" && (
                        <div className="flex justify-end"><ActionButton run={reverseCommissionAction.bind(null, c.id)} label={tr("عكس")} done={tr("عُكست العمولة")}
                          errors={t.errors} variant="ghost" reasonLabel={tr("سبب العكس")} /></div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </section>
      )}
    </>
  );
}
