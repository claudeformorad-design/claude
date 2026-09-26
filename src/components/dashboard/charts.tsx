"use client";

import { useEffect, useRef, useState } from "react";
import { animate, motion, useInView } from "motion/react";
import { Activity, PieChart as PieIcon, TrendingUp } from "lucide-react";
import { CHART_COLORS } from "./chart-colors";

/**
 * مخططات لوحة التحكم (SVG خفيف بحركة ناعمة). القيم تُمرَّر كما هي من الأستاذ العام
 * والدفاتر الفرعية — لا تقدير ولا تنعيم للبيانات؛ التقريب للعرض فقط، والخطوط مستقيمة
 * بين النقاط حتى لا يُظهر المنحنى قيمة لم تحدث.
 */

const fmt = (v: number, digits = 0) =>
  new Intl.NumberFormat("ar-SA-u-nu-latn", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);

const compact = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${fmt(v / 1_000_000, 1)}M`;
  if (a >= 1_000) return `${fmt(v / 1_000, a >= 10_000 ? 0 : 1)}k`;
  return fmt(v);
};


const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
function monthLabel(m: string, short = false): string {
  const [y, mo] = m.split("-");
  const name = MONTHS[parseInt(mo ?? "1", 10) - 1] ?? m;
  return short ? name : `${name} ${y ?? ""}`.trim();
}

function linePath(pts: ({ x: number; y: number } | null)[]): string {
  let d = "";
  let pen = false;
  for (const p of pts) {
    if (!p) { pen = false; continue; }
    d += `${pen ? " L" : " M"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
    pen = true;
  }
  return d.trim();
}

function EmptyChart({ icon: Icon = Activity, title, hint }: { icon?: typeof Activity; title: string; hint: string }) {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300/80 bg-white/40 px-4 py-8 text-center">
      <div className="animate-pop mb-3 flex size-11 items-center justify-center rounded-2xl bg-ink text-white">
        <Icon className="size-5" />
      </div>
      <p className="text-[13px] font-medium text-ink">{title}</p>
      <p className="mt-1 max-w-xs text-[11px] leading-relaxed text-muted-foreground">{hint}</p>
    </div>
  );
}

// =============================================================================
// رقم متحرك: يعدّ من الصفر حتى القيمة عند ظهوره. النص النهائي هو القيمة الدقيقة المنسّقة من الخادم.
// =============================================================================
export function AnimatedNumber({ value, text, digits = 2, className }: { value: number; text: string; digits?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  useEffect(() => {
    const el = ref.current;
    if (!el || !inView || !Number.isFinite(value) || value === 0) return;
    const controls = animate(0, value, {
      duration: 1.4,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => { el.textContent = fmt(v, digits); },
      onComplete: () => { el.textContent = text; },
    });
    return () => controls.stop();
  }, [inView, value, text, digits]);
  return <span ref={ref} className={`num ${className ?? ""}`}>{text}</span>;
}

// =============================================================================
// الإيرادات مقابل المصروفات (خطان + تلميح عند المرور)
// =============================================================================
export function IncomeExpenseChart({
  data, currency, labels,
}: {
  data: { month: string; revenue: number; expenses: number }[];
  currency: string;
  labels: { revenue: string; expenses: string; net: string };
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (!data.some((d) => d.revenue !== 0 || d.expenses !== 0)) {
    return <EmptyChart title="لا توجد حركات مرحّلة بعد" hint="يُرسم المخطط من القيود المرحّلة في الأستاذ العام تلقائيًا." />;
  }
  const W = 560, H = 230, padX = 18, padT = 18, padB = 34, axisW = 44;
  const plotW = W - padX * 2 - axisW, plotH = H - padT - padB;
  const top = Math.max(...data.map((d) => Math.max(d.revenue, d.expenses)), 0);
  const bottom = Math.min(...data.map((d) => Math.min(d.revenue, d.expenses)), 0);
  const maxV = top + (top - bottom || 1) * 0.15;
  const minV = bottom < 0 ? bottom * 1.15 : 0;
  const x = (i: number) => padX + axisW + (data.length === 1 ? plotW / 2 : (plotW * i) / (data.length - 1));
  const y = (v: number) => padT + ((maxV - v) / (maxV - minV)) * plotH;
  const rev = data.map((d, i) => ({ x: x(i), y: y(d.revenue) }));
  const exp = data.map((d, i) => ({ x: x(i), y: y(d.expenses) }));
  const base = y(Math.max(minV, 0));
  const area = `${linePath(rev)} L ${rev[rev.length - 1]!.x} ${base} L ${rev[0]!.x} ${base} Z`;
  const ticks = [0, 1, 2, 3].map((k) => minV + ((maxV - minV) * k) / 3);
  const h = hover !== null ? data[hover] : undefined;

  return (
    <div className="space-y-3" data-chart="financial">
      <div className="relative" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="h-[230px] w-full overflow-visible" role="img" aria-label={`${labels.revenue} / ${labels.expenses}`}>
          <defs>
            <linearGradient id="revArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS.revenue} stopOpacity="0.28" />
              <stop offset="100%" stopColor={CHART_COLORS.revenue} stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((v, k) => (
            <g key={k}>
              <line x1={padX + axisW} x2={W - padX} y1={y(v)} y2={y(v)} stroke="#e2e8f0" strokeDasharray="3 5" />
              <text x={padX} y={y(v) + 4} fill="#94a3b8" fontSize="10.5">{compact(v)}</text>
            </g>
          ))}
          <path d={area} fill="url(#revArea)" className="animate-fade" style={{ animationDelay: "0.6s" }} />
          <path d={linePath(exp)} fill="none" stroke={CHART_COLORS.expenses} strokeWidth="2.5" strokeLinejoin="round" pathLength={1}
            strokeDasharray="1" className="animate-draw" />
          <path d={linePath(rev)} fill="none" stroke={CHART_COLORS.revenue} strokeWidth="3" strokeLinejoin="round" pathLength={1}
            strokeDasharray="1" className="animate-draw" />
          {hover !== null && (
            <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + plotH} stroke="#0e1116" strokeOpacity="0.35" strokeDasharray="4 4" />
          )}
          {data.map((_, i) => (
            <g key={i}>
              <circle cx={rev[i]!.x} cy={rev[i]!.y} r={hover === i ? 6 : 3.5} fill="#fff" stroke={CHART_COLORS.revenue} strokeWidth="2.5"
                className="animate-pop transition-all" style={{ animationDelay: `${0.8 + i * 0.06}s` }} />
              <circle cx={exp[i]!.x} cy={exp[i]!.y} r={hover === i ? 6 : 3.5} fill="#fff" stroke={CHART_COLORS.expenses} strokeWidth="2.5"
                className="animate-pop transition-all" style={{ animationDelay: `${0.8 + i * 0.06}s` }} />
              <text x={x(i)} y={H - 8} textAnchor="middle" fill={hover === i ? "#0e1116" : "#94a3b8"} fontSize="10.5">{monthLabel(data[i]!.month, true)}</text>
              <rect x={x(i) - plotW / data.length / 2} y={padT} width={plotW / data.length} height={plotH} fill="transparent"
                onMouseEnter={() => setHover(i)} className="cursor-crosshair" />
            </g>
          ))}
        </svg>
        {h && hover !== null && (
          <motion.div
            key={hover}
            initial={{ opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className="pointer-events-none absolute top-1 z-10 w-48 -translate-x-1/2 rounded-2xl bg-ink/95 p-3 text-[11px] text-white shadow-xl"
            style={{ left: `${(x(hover) / W) * 100}%` }}
          >
            <p className="mb-1.5 font-medium">{monthLabel(h.month)}</p>
            <Row color={CHART_COLORS.revenue} label={labels.revenue} value={h.revenue} currency={currency} />
            <Row color={CHART_COLORS.expenses} label={labels.expenses} value={h.expenses} currency={currency} />
            <div className="mt-1.5 border-t border-white/15 pt-1.5">
              <Row color={CHART_COLORS.net} label={labels.net} value={h.revenue - h.expenses} currency={currency} />
            </div>
          </motion.div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-600">
        <Dot color={CHART_COLORS.revenue} label={labels.revenue} />
        <Dot color={CHART_COLORS.expenses} label={labels.expenses} />
        <span className="ms-auto text-slate-400">المبالغ بـ {currency}</span>
      </div>
    </div>
  );
}

function Row({ color, label, value, currency }: { color: string; label: string; value: number; currency: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 text-white/70"><span className="size-2 rounded-full" style={{ background: color }} />{label}</span>
      <span className="num">{fmt(value, 2)} <span className="text-white/50">{currency}</span></span>
    </div>
  );
}

function Dot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="size-2.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

// =============================================================================
// دائرة (Donut) بحركة كنس للأجزاء
// =============================================================================
export function DonutChart({
  segments, centerTitle, centerValue, emptyTitle, emptyHint, valueSuffix,
}: {
  segments: { label: string; value: number; color: string; display?: string }[];
  centerTitle: string;
  centerValue: string;
  emptyTitle: string;
  emptyHint: string;
  valueSuffix?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const items = segments.filter((s) => s.value > 0);
  const total = items.reduce((s, x) => s + x.value, 0);
  if (!items.length || total <= 0) return <EmptyChart icon={PieIcon} title={emptyTitle} hint={emptyHint} />;

  const size = 190, c = size / 2, r = 70, sw = 26, circ = 2 * Math.PI * r;
  const gap = items.length > 1 ? 4 : 0;
  const a = active !== null ? items[active] : undefined;

  return (
    <div className="flex flex-col items-center gap-4" data-chart="donut">
      <div className="relative">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle cx={c} cy={c} r={r} fill="none" stroke="#eef1f6" strokeWidth={sw} />
          {items.map((s, i) => {
            const before = items.slice(0, i).reduce((acc, x) => acc + x.value, 0) / total;
            const len = Math.max((s.value / total) * circ - gap, 0.5);
            return (
              <circle
                key={s.label}
                cx={c} cy={c} r={r} fill="none" stroke={s.color} strokeLinecap={items.length > 1 ? "round" : "butt"}
                strokeDasharray={`${len} ${circ}`}
                strokeDashoffset={-before * circ}
                strokeWidth={active === i ? sw + 6 : sw}
                onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}
                className="donut-seg cursor-pointer"
                style={{ ["--circ" as string]: circ, animationDelay: `${0.15 + i * 0.12}s` }}
              />
            );
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="max-w-24 truncate text-[11px] text-muted-foreground">{a ? a.label : centerTitle}</span>
          <span key={a?.label ?? "total"} className="animate-pop num text-lg font-semibold text-ink">
            {a ? `${fmt((a.value / total) * 100, 1)}%` : centerValue}
          </span>
        </div>
      </div>
      <div className="flex w-full flex-wrap justify-center gap-x-4 gap-y-2 text-[12px]">
        {items.map((s, i) => (
          <button key={s.label} type="button" onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}
            className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 transition-colors ${active === i ? "bg-white" : ""}`}>
            <span className="size-2.5 rounded-full" style={{ background: s.color }} />
            <span className="text-slate-600">{s.label}:</span>
            <span className="num font-medium text-ink">{s.display ?? fmt(s.value)}</span>
            {valueSuffix && <span className="text-slate-400">{valueSuffix}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// أشرطة مخططة متحركة (مثل «نظرة على الفواتير»)
// =============================================================================
export function StripedBars({
  rows, currency, emptyTitle, emptyHint,
}: {
  rows: { label: string; count: number; amount: number; amountText: string; color: string }[];
  currency: string;
  emptyTitle: string;
  emptyHint: string;
}) {
  const max = Math.max(...rows.map((r) => r.amount), 0);
  if (max <= 0) return <EmptyChart title={emptyTitle} hint={emptyHint} />;
  return (
    <div className="space-y-4" data-chart="bars">
      {rows.map((r, i) => (
        <div key={r.label} className="space-y-1.5">
          <div className="flex items-center justify-between text-[13px]">
            <span className="font-medium text-ink">{r.label}</span>
            <span className="text-slate-500">
              <span className="num">{r.count}</span> <span className="mx-1 text-slate-300">|</span>
              <span className="num font-medium text-ink">{r.amountText}</span> <span className="text-[11px]">{currency}</span>
            </span>
          </div>
          <div className="h-3.5 overflow-hidden rounded-full bg-[repeating-linear-gradient(-45deg,#e7ebf1_0_6px,#f1f4f8_6px_12px)]">
            <div
              className="bar-stripes animate-grow-x h-full rounded-full"
              style={{
                width: `${Math.max((r.amount / max) * 100, r.amount > 0 ? 3 : 0)}%`,
                backgroundColor: r.color,
                transformOrigin: "right",
                animationDelay: `${0.1 + i * 0.1}s`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// =============================================================================
// اتجاه ADR وRevPAR والإشغال شهريًا
// =============================================================================
export function RoomTrendChart({
  data, currency,
}: {
  data: { month: string; adr: number | null; revpar: number | null; occupancy: number | null; nights: number }[];
  currency: string;
}) {
  if (!data.some((d) => d.nights > 0)) {
    return <EmptyChart icon={TrendingUp} title="لا توجد ليالٍ مباعة في الفترة" hint="تُحسب من رسوم فئة «غرف» على الفوليو وعدد الغرف في إعدادات الفندق." />;
  }
  const W = 520, H = 200, padX = 18, axisW = 40, padT = 16, padB = 46;
  const plotW = W - padX * 2 - axisW, plotH = H - padT - padB;
  const maxV = Math.max(...data.map((d) => Math.max(d.adr ?? 0, d.revpar ?? 0)), 1) * 1.2;
  const x = (i: number) => padX + axisW + (data.length === 1 ? plotW / 2 : (plotW * i) / (data.length - 1));
  const y = (v: number) => padT + plotH - (v / maxV) * plotH;
  const adr = data.map((d, i) => (d.adr === null ? null : { x: x(i), y: y(d.adr) }));
  const rp = data.map((d, i) => (d.revpar === null ? null : { x: x(i), y: y(d.revpar) }));

  return (
    <div className="space-y-2" data-chart="rooms">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[200px] w-full overflow-visible" role="img" aria-label="ADR / RevPAR">
        {[0, maxV / 2, maxV].map((v, k) => (
          <g key={k}>
            <line x1={padX + axisW} x2={W - padX} y1={y(v)} y2={y(v)} stroke="#e2e8f0" strokeDasharray="3 5" />
            <text x={padX} y={y(v) + 4} fill="#94a3b8" fontSize="10.5">{compact(v)}</text>
          </g>
        ))}
        <path d={linePath(adr)} fill="none" stroke={CHART_COLORS.revenue} strokeWidth="2.75" pathLength={1} strokeDasharray="1" className="animate-draw" />
        <path d={linePath(rp)} fill="none" stroke={CHART_COLORS.expenses} strokeWidth="2.25" pathLength={1} strokeDasharray="1" className="animate-draw" />
        {data.map((d, i) => (
          <g key={i}>
            {adr[i] && <circle cx={adr[i].x} cy={adr[i].y} r={3.5} fill="#fff" stroke={CHART_COLORS.revenue} strokeWidth="2.5" />}
            {rp[i] && <circle cx={rp[i].x} cy={rp[i].y} r={3.5} fill="#fff" stroke={CHART_COLORS.expenses} strokeWidth="2.5" />}
            <text x={x(i)} y={H - 26} textAnchor="middle" fill="#94a3b8" fontSize="10.5">{monthLabel(d.month, true)}</text>
            <text x={x(i)} y={H - 8} textAnchor="middle" fill="#0e1116" fontSize="10.5" fontWeight="500">
              {d.occupancy === null ? "—" : `${fmt(d.occupancy, 1)}%`}
            </text>
          </g>
        ))}
      </svg>
      <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-600">
        <Dot color={CHART_COLORS.revenue} label="ADR" />
        <Dot color={CHART_COLORS.expenses} label="RevPAR" />
        <span className="ms-auto text-slate-400">أسفل كل شهر: نسبة الإشغال • المبالغ بـ {currency}</span>
      </div>
    </div>
  );
}
