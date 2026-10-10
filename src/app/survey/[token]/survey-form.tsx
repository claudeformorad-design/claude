"use client";
import { tr } from "@/i18n/tr";

import { useState, useTransition } from "react";
import { Star } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SURVEY_ASPECTS } from "@/lib/ops/labels";
import { cn } from "@/lib/utils";
import { submitSurveyAction } from "./actions";

type Ratings = Record<"overall" | (typeof SURVEY_ASPECTS)[number]["key"], number | null>;

function Stars({ label, value, onChange, large }: { label: string; value: number | null; onChange: (v: number) => void; large?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3">
      <span className={cn("text-ink", large ? "text-[19px] font-semibold" : "text-[16px]")}>{label}</span>
      <div className="flex gap-1" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={tr("{0} من 5", n)} onClick={() => onChange(n)}
            className="rounded-md p-1 transition-transform active:scale-90">
            <Star className={cn(large ? "size-9" : "size-7", value !== null && n <= value ? "fill-amber text-amber" : "text-slate-300")} />
          </button>
        ))}
      </div>
    </div>
  );
}

/** نموذج التقييم بالنجوم: التقييم العام إلزامي، والجوانب والتوصية والتعليق اختيارية */
export function SurveyForm({ token }: { token: string }) {
  const [pending, start] = useTransition();
  const [r, setR] = useState<Ratings>({ overall: null, cleanliness: null, staff: null, comfort: null, value: null, food: null });
  const [recommend, setRecommend] = useState<boolean | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <div className="py-10 text-center">
        <p className="text-[24px] font-bold text-ink">{tr("شكرًا لك")}</p>
        <p className="mt-2 text-slate-600">{tr("وصل تقييمك، ونسعد بزيارتك مرة أخرى.")}</p>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      if (!r.overall) { setError(tr("اختر التقييم العام")); return; }
      start(async () => {
        setError(null);
        const res = await submitSurveyAction(token, { ...r, recommend, comment });
        if (res.ok) setDone(true); else setError(res.message ?? tr("تعذر إرسال التقييم، حاول مرة أخرى"));
      });
    }}>
      {error && <Alert variant="destructive" className="mb-4">{error}</Alert>}
      <div className="divide-y divide-line">
        <Stars large label={tr("تقييمك العام لإقامتك")} value={r.overall} onChange={(v) => setR({ ...r, overall: v })} />
        {SURVEY_ASPECTS.map((a) => <Stars key={a.key} label={a.label} value={r[a.key]} onChange={(v) => setR({ ...r, [a.key]: v })} />)}
        <div className="flex flex-wrap items-center justify-between gap-3 py-3">
          <span className="text-[16px] text-ink">{tr("هل توصي بنا لأصدقائك؟")}</span>
          <div className="flex gap-2">
            <Button type="button" variant={recommend === true ? "default" : "outline"} onClick={() => setRecommend(true)}>{tr("نعم")}</Button>
            <Button type="button" variant={recommend === false ? "default" : "outline"} onClick={() => setRecommend(false)}>{tr("لا")}</Button>
          </div>
        </div>
      </div>
      <label htmlFor="comment" className="mt-4 block text-[16px] text-ink">{tr("ملاحظاتك")}</label>
      <Textarea id="comment" rows={4} className="mt-2" value={comment} maxLength={2000} onChange={(e) => setComment(e.target.value)} />
      <Button type="submit" size="default" className="mt-6 w-full" loading={pending}>{tr("إرسال التقييم")}</Button>
    </form>
  );
}
