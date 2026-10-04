import { tr } from "@/i18n/tr";
import { forbidden } from "next/navigation";
import { MessageSquareText, Smile, Star, ThumbsUp } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { formatDateTime, todayInTimeZone } from "@/lib/accounting/fiscal";
import { addDays, dayLabel } from "@/lib/pms/dates";
import { SURVEY_ASPECTS } from "@/lib/ops/labels";
import type { GuestSurveyRow } from "@/lib/supabase/database.types";
import { listSurveys } from "@/services/guest-services.service";
import { getI18n } from "@/i18n/server";
import { SimpleForm } from "../_assets/simple-form";
import { recordPaperSurveyAction } from "../_services/actions";

const PERIODS = { "30": 30, "90": 90, "365": 365 } as const;
type Period = keyof typeof PERIODS;

const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => typeof x === "number");
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const fmt = (n: number | null) => (n === null ? "" : n.toFixed(1));

/**
 * رضا النزلاء: استبيان يُنشأ عند كل مغادرة برمز خاص، يعبّئه النزيل من جهاز الاستقبال أو برابطه،
 * أو يُدخل من ورقة. التقرير: المتوسط العام ولكل جانب، توزيع الدرجات، نسبة من يوصي بالفندق، والتعليقات.
 */
export default async function SurveysPage({ searchParams }: { searchParams: Promise<{ period?: string; tab?: string }> }) {
  const ctx = await requireAppContext();
  if (!ctx.can(PERMISSIONS.feedbackView) && !ctx.can(PERMISSIONS.feedbackManage)) forbidden();
  const { t } = await getI18n();
  const sp = await searchParams;
  const period: Period = sp.period === "90" || sp.period === "365" ? sp.period : "30";
  const today = todayInTimeZone(ctx.hotel.timezone);
  const since = addDays(today, -PERIODS[period]);
  const all = await listSurveys(ctx.supabase, ctx.hotel.id, since);
  const done = all.filter((s) => s.status === "completed");
  const pending = all.filter((s) => s.status === "pending");
  const fromCheckout = all.filter((s) => s.reservation_id);
  const rate = fromCheckout.length ? Math.round((fromCheckout.filter((s) => s.status === "completed").length / fromCheckout.length) * 100) : null;
  const rec = done.filter((s) => s.recommend !== null);
  const recPct = rec.length ? Math.round((rec.filter((s) => s.recommend).length / rec.length) * 100) : null;
  const overall = avg(done.map((s) => s.overall));
  const dist = [5, 4, 3, 2, 1].map((n) => ({ n, count: done.filter((s) => s.overall === n).length }));
  const max = Math.max(1, ...dist.map((d) => d.count));
  const tab = sp.tab === "pending" ? "pending" : "comments";
  const comments = done.filter((s) => s.comment || (s.overall ?? 5) <= 2);
  const canManage = ctx.can(PERMISSIONS.feedbackManage);
  const q = (p: string, tb = tab) => `/surveys?period=${p}${tb === "pending" ? "&tab=pending" : ""}`;
  const ratingOptions = [5, 4, 3, 2, 1].map((n) => ({ id: String(n), label: String(n) }));

  return (
    <>
      <PageHeader title={tr("تقييمات النزلاء")} actions={canManage && (
        <FormDialog label={tr("استمارة ورقية")} title={tr("إدخال تقييم من استمارة ورقية")} width="lg">
          <SimpleForm columns={2} submitLabel={tr("حفظ التقييم")} errors={t.errors} action={recordPaperSurveyAction}
            initial={{ guest_name: "", room_number: "", overall: "5", cleanliness: "", staff: "", comfort: "", value: "", food: "", recommend: "", comment: "" }}
            fields={[
              { name: "guest_name", label: tr("اسم النزيل") }, { name: "room_number", label: tr("الغرفة"), ltr: true },
              { name: "overall", label: tr("التقييم العام"), options: ratingOptions },
              ...SURVEY_ASPECTS.map((a) => ({ name: a.key, label: a.label, options: ratingOptions, optional: true })),
              { name: "recommend", label: tr("يوصي بالفندق"), optional: true, options: [{ id: "yes", label: tr("نعم") }, { id: "no", label: tr("لا") }] },
              { name: "comment", label: tr("التعليق") },
            ]} />
        </FormDialog>
      )} />
      <div className="mb-4">
        <FilterTabs active={period} items={[
          { key: "30", href: q("30"), label: tr("آخر 30 يومًا") },
          { key: "90", href: q("90"), label: tr("آخر 90 يومًا") },
          { key: "365", href: q("365"), label: tr("آخر سنة") },
        ]} />
      </div>
      <StatGrid>
        <Stat icon={Star} tone="ink" label={tr("التقييم العام من 5")} value={<span className="num">{fmt(overall) || tr("لا يوجد")}</span>} hint={tr("{0} تقييم", done.length)} />
        <Stat icon={ThumbsUp} tone="teal" label={tr("يوصون بالفندق")} value={<span className="num">{recPct === null ? tr("لا يوجد") : `${recPct}%`}</span>} />
        <Stat icon={Smile} tone="clay" label={tr("نسبة الاستجابة")} value={<span className="num">{rate === null ? tr("لا يوجد") : `${rate}%`}</span>} hint={tr("من المغادرين")} />
        <Stat icon={MessageSquareText} tone="neutral" label={tr("بانتظار التعبئة")} value={<span className="num">{pending.length}</span>} />
      </StatGrid>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{tr("الجوانب")}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {SURVEY_ASPECTS.map((a) => {
              const v = avg(done.map((s) => s[a.key as keyof GuestSurveyRow] as number | null));
              return (
                <div key={a.key} className="grid grid-cols-[10rem_1fr_3rem] items-center gap-3">
                  <span className="text-[15px]">{a.label}</span>
                  <div className="h-2 overflow-hidden rounded-full bg-neutral-tint"><div className="h-full rounded-full bg-ink" style={{ width: `${((v ?? 0) / 5) * 100}%` }} /></div>
                  <span className="num text-end font-semibold">{fmt(v)}</span>
                </div>
              );
            })}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{tr("توزيع التقييم العام")}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {dist.map((d) => (
              <div key={d.n} className="grid grid-cols-[3rem_1fr_3rem] items-center gap-3">
                <span className="num font-semibold">{d.n}</span>
                <div className="h-2 overflow-hidden rounded-full bg-neutral-tint"><div className="h-full rounded-full bg-ink" style={{ width: `${(d.count / max) * 100}%` }} /></div>
                <span className="num text-end text-slate-600">{d.count}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader>
          <FilterTabs active={tab} items={[
            { key: "comments", href: q(period, "comments"), label: tr("التعليقات والتقييمات المنخفضة"), count: comments.length },
            { key: "pending", href: q(period, "pending"), label: tr("بانتظار النزيل"), count: pending.length },
          ]} />
        </CardHeader>
        {tab === "comments" ? (
          <Table>
            <TableHeader><TableRow><TableHead>{tr("النزيل")}</TableHead><TableHead>{tr("التقييم")}</TableHead><TableHead>{tr("التعليق")}</TableHead><TableHead>{tr("المصدر")}</TableHead></TableRow></TableHeader>
            <TableBody>
              {comments.length === 0 && <TableRow><TableCell colSpan={4}><EmptyState icon={MessageSquareText} title={tr("لا تعليقات في هذه الفترة")} /></TableCell></TableRow>}
              {comments.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="whitespace-nowrap">{s.guest_name || tr("نزيل")}{s.room_number && <span className="block text-[14px] text-slate-500">{tr("غرفة {0}", s.room_number)}</span>}</TableCell>
                  <TableCell><Badge variant={(s.overall ?? 0) <= 2 ? "destructive" : (s.overall ?? 0) === 3 ? "warning" : "success"}><span className="num">{s.overall}</span></Badge></TableCell>
                  <TableCell className="cell-fluid whitespace-pre-line">{s.comment}</TableCell>
                  <TableCell className="whitespace-nowrap text-slate-600">
                    {s.channel === "paper" ? tr("استمارة ورقية") : s.channel === "link" ? tr("رابط") : tr("جهاز الاستقبال")}
                    {s.completed_at && <span className="block num text-[14px]">{formatDateTime(s.completed_at, ctx.hotel.timezone).slice(0, 10)}</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>{tr("النزيل")}</TableHead><TableHead>{tr("المغادرة")}</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {pending.length === 0 && <TableRow><TableCell colSpan={3}><EmptyState icon={Smile} title={tr("لا استبيانات بانتظار التعبئة")} description={tr("يُنشأ استبيان تلقائيًا عند كل مغادرة.")} /></TableCell></TableRow>}
              {pending.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="cell-fluid">{s.guest_name || tr("نزيل")}{s.room_number && <span className="block text-[14px] text-slate-500">{tr("غرفة {0}", s.room_number)}</span>}</TableCell>
                  <TableCell className="whitespace-nowrap text-slate-600">{dayLabel(formatDateTime(s.created_at, ctx.hotel.timezone).slice(0, 10))}</TableCell>
                  <TableCell className="text-end">
                    <a href={`/survey/${s.token}`} target="_blank" rel="noopener" className="font-medium text-ink underline-offset-4 hover:underline">{tr("فتح الاستبيان للنزيل")}</a>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
