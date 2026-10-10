"use client";
import { tr } from "@/i18n/tr";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import {
  BarChart3, BedDouble, CalendarCheck, KeyRound, Landmark, Link2, ShieldCheck, type LucideIcon,
} from "lucide-react";
import { BRAND_N } from "@/components/brand-mark";
import { AssistantMark } from "@/components/assistant/mark";

export const INTRO_SEEN_KEY = "nazeel:intro-seen";

type Scene = { icon?: LucideIcon | "assistant"; title: string; text: string };

const scenes = (): Scene[] => [
  { title: tr("أهلًا بك في نزيل"), text: tr("نظام واحد يدير فندقك ويحسب كل ريال فيه.") },
  { icon: CalendarCheck, title: tr("الحجوزات"), text: tr("احجز في ثوانٍ، والنظام يمنع حجز الغرفة نفسها مرتين.") },
  { icon: BedDouble, title: tr("النزلاء والغرف"), text: tr("ملف لكل نزيل، وحالة كل غرفة أمامك لحظة بلحظة.") },
  { icon: KeyRound, title: tr("التسكين والمغادرة"), text: tr("سلّم المفتاح بضغطة، وعند المغادرة تصدر الفاتورة وحدها.") },
  { icon: Landmark, title: tr("محاسبة الفندق"), text: tr("كل دفعة ومصروف يصبح قيدًا محاسبيًا متوازنًا تلقائيًا.") },
  { icon: BarChart3, title: tr("التقارير"), text: tr("الإشغال والإيرادات والأرباح، جاهزة متى احتجتها.") },
  { icon: ShieldCheck, title: tr("الموظفون والصلاحيات"), text: tr("كل موظف يرى ما يخص عمله فقط، ويدخل برابط منك.") },
  { icon: "assistant", title: tr("المساعد الذكي"), text: tr("اسأله عن أي رقم أو مشكلة، ويجيبك من بيانات فندقك.") },
  { icon: Link2, title: tr("كل شيء مترابط"), text: tr("الحجز والغرفة والفوليو والحسابات تتحدث معًا دون إدخال مكرر.") },
];

const STEP_MS = 3200;
const noop = () => () => {};
const readSeen = () => { try { return localStorage.getItem(INTRO_SEEN_KEY) === "1"; } catch { return false; } };

/**
 * تعريف أول استخدام بعد «ابدأ»: مشاهد قصيرة متتالية بنص متحرك بهدوء، تُتخطى في أي لحظة،
 * ثم انتقال ناعم إلى النظام. تُحفظ مشاهدته في المتصفح فلا يظهر مرة أخرى إلا بطلب صريح.
 */
export function Intro({ next, replay = false }: { next: string; replay?: boolean }) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const list = React.useMemo(() => scenes(), []);
  const last = list.length; // المشهد الأخير: الدخول
  const [i, setI] = React.useState(0);
  const [leaving, setLeaving] = React.useState(false);
  // null في الخادم (لا يُعرف بعد)، ثم قيمة المتصفح
  const seen = React.useSyncExternalStore(noop, readSeen, () => null);
  const checked = replay || seen === false;

  const finish = React.useCallback(() => {
    try { localStorage.setItem(INTRO_SEEN_KEY, "1"); } catch { /* التخزين غير متاح */ }
    setLeaving(true);
    setTimeout(() => router.replace(next), reduce ? 0 : 650);
  }, [next, reduce, router]);

  // شوهد من قبل على هذا الجهاز: مباشرة للنظام
  React.useEffect(() => { if (!replay && seen) router.replace(next); }, [next, replay, router, seen]);

  React.useEffect(() => { router.prefetch(next); }, [next, router]);

  React.useEffect(() => {
    if (!checked || leaving || i >= last) return;
    const t = setTimeout(() => setI((v) => v + 1), i === 0 ? STEP_MS + 600 : STEP_MS);
    return () => clearTimeout(t);
  }, [checked, i, last, leaving]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      else if (e.key === "ArrowLeft" || e.key === " ") setI((v) => Math.min(last, v + 1));
      else if (e.key === "ArrowRight") setI((v) => Math.max(0, v - 1));
      else if (e.key === "Enter" && i >= last) finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finish, i, last]);

  if (!checked) return <main className="min-h-screen bg-[#f7f5f0]" />;
  const scene = list[i];
  const ease = [0.22, 1, 0.36, 1] as const;

  return (
    <m.main
      className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#f7f5f0] px-6"
      animate={leaving ? { opacity: 0, scale: 1.02 } : { opacity: 1, scale: 1 }}
      transition={{ duration: reduce ? 0 : 0.6, ease }}
    >
      {/* تقدم المشاهد */}
      <div className="absolute inset-x-0 top-0 flex gap-1.5 px-6 pt-6 sm:px-10" aria-hidden>
        {list.map((_, k) => (
          <span key={k} className="h-[3px] flex-1 overflow-hidden rounded-full bg-ink/10">
            <m.span className="block h-full origin-right rounded-full bg-ink/70"
              initial={false}
              animate={{ scaleX: k < i ? 1 : k === i ? 1 : 0 }}
              transition={{ duration: k === i && !reduce ? (k === 0 ? STEP_MS + 600 : STEP_MS) / 1000 : 0.2, ease: "linear" }} />
          </span>
        ))}
      </div>
      {i < last && <button type="button" onClick={finish}
        className="absolute end-5 top-10 rounded-lg px-3 py-2 text-[15.5px] font-medium text-slate-500 transition-colors hover:text-ink sm:end-9">
        {tr("تخطي")}
      </button>}

      <div className="flex w-full max-w-[560px] flex-col items-center text-center" aria-live="polite">
        <AnimatePresence mode="wait">
          {i < last ? (
            <m.div key={i} className="flex flex-col items-center"
              initial={{ opacity: 0, y: reduce ? 0 : 18, filter: reduce ? "none" : "blur(6px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: reduce ? 0 : -14, filter: reduce ? "none" : "blur(4px)" }}
              transition={{ duration: reduce ? 0 : 0.55, ease }}>
              {i === 0 ? (
                <svg viewBox="0 0 100 100" aria-hidden className="size-[84px] overflow-visible">
                  <rect className="mark-room" width="100" height="100" rx="24" fill="#312F2E" />
                  <path className="mark-letter" fill="#FFFFFF" d={BRAND_N} />
                  <circle className="mark-guest" cx="69.94" cy="69.75" r="5.25" fill="#2483E1" />
                </svg>
              ) : (
                <m.span className="flex size-16 items-center justify-center rounded-2xl bg-white text-ink shadow-[0_1px_0_rgba(0,0,0,0.04),0_12px_32px_-16px_rgba(49,47,46,0.35)] ring-1 ring-line"
                  initial={{ scale: reduce ? 1 : 0.85, rotate: reduce ? 0 : -6 }} animate={{ scale: 1, rotate: 0 }}
                  transition={{ duration: reduce ? 0 : 0.7, ease }}>
                  {scene!.icon === "assistant" ? <AssistantMark className="size-7" /> : scene!.icon ? React.createElement(scene!.icon, { className: "size-7 stroke-[1.6]" }) : null}
                </m.span>
              )}
              {i > 0 && <p className="mt-8 text-[14px] font-medium tracking-wide text-slate-400"><span className="num">{i}</span>{" "}{tr("من")}{" "}<span className="num">{last - 1}</span></p>}
              <h1 className={i === 0 ? "mt-8 text-[38px] font-bold leading-tight tracking-tight text-ink sm:text-[46px]" : "mt-3 text-[34px] font-bold leading-tight tracking-tight text-ink sm:text-[42px]"}>
                {scene!.title}
              </h1>
              <m.p className="mt-4 max-w-[440px] text-[18px] leading-relaxed text-slate-500 sm:text-[19px]"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: reduce ? 0 : 0.25, duration: reduce ? 0 : 0.6 }}>
                {scene!.text}
              </m.p>
            </m.div>
          ) : (
            <m.div key="go" className="flex w-full max-w-[360px] flex-col items-center"
              initial={{ opacity: 0, y: reduce ? 0 : 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduce ? 0 : 0.6, ease }}>
              <h1 className="text-[38px] font-bold leading-tight tracking-tight text-ink sm:text-[44px]">{replay ? tr("هذا هو نزيل") : tr("فندقك جاهز للبدء")}</h1>
              <p className="mt-4 text-[18px] leading-relaxed text-slate-500">{replay ? tr("كل قسم ذكرناه تجده في القائمة الجانبية.") : tr("أنشئ ملف الفندق في دقيقة، ثم ابدأ أول حجز.")}</p>
              <button type="button" onClick={finish} autoFocus
                className="mt-10 h-[52px] w-full rounded-xl bg-ink text-[18px] font-semibold text-white transition-colors hover:bg-black">
                {replay ? tr("العودة للنظام") : tr("ادخل النظام")}
              </button>
            </m.div>
          )}
        </AnimatePresence>
      </div>

      {/* تنقل يدوي بين المشاهد */}
      {i < last && (
        <div className="absolute inset-x-0 bottom-8 flex justify-center gap-2">
          <button type="button" onClick={() => setI((v) => Math.max(0, v - 1))} disabled={i === 0}
            className="h-10 rounded-lg px-4 text-[15.5px] font-medium text-slate-500 transition-colors hover:text-ink disabled:opacity-0">{tr("السابق")}</button>
          <button type="button" onClick={() => setI((v) => Math.min(last, v + 1))}
            className="h-10 rounded-lg border border-line bg-white px-5 text-[15.5px] font-medium text-ink transition-colors hover:bg-panel">{tr("التالي")}</button>
        </div>
      )}
    </m.main>
  );
}
