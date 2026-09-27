"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, animate, motion, useInView } from "motion/react";
import { CHART_COLORS } from "./chart-colors";

/**
 * مخططات لوحة التحكم (SVG خفيف، تفاعلي، بحركة ناعمة). القيم تُمرَّر كما هي من الأستاذ العام
 * والدفاتر الفرعية — لا تقدير ولا تنعيم؛ التقريب للعرض فقط.
 * قواعد الرسم: محور واحد، شبكة باهتة، أعمدة رفيعة بنهايات مستديرة 4px وفاصل 2px بين المتجاورات،
 * خطوط 2px، مفتاح دائم لأكثر من سلسلة، وتلميح عند المرور على كل عنصر. النصوص بألوان النص لا بلون السلسلة.
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

const GRID = "#eceae3";
const AXIS_TEXT = "#53514d";

/** محور بقيم «مستديرة» (1، 2، 2.5، 5 × 10ⁿ) يشمل الصفر وأي قيم سالبة */
function niceScale(min: number, max: number, count = 4): { lo: number; hi: number; ticks: number[] } {
  const span = max - min || Math.abs(max) || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { lo, hi, ticks };
}

/** عرض الحاوية الفعلي حتى تُرسم المخططات بمقاسها الحقيقي (نص بحجم ثابت مهما ضاقت البطاقة) */
function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry?.contentRect.width ?? 0);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** عمود بنهاية مستديرة 4px من جهة القيمة فقط، وقاعدة مستقيمة على خط الصفر */
function barPath(x: number, w: number, y0: number, y1: number, r = 4): string {
  const h = Math.abs(y1 - y0);
  if (h < 0.5) return "";
  const rr = Math.min(r, w / 2, h);
  if (y1 < y0) {
    return `M${x},${y0} V${y1 + rr} Q${x},${y1} ${x + rr},${y1} H${x + w - rr} Q${x + w},${y1} ${x + w},${y1 + rr} V${y0} Z`;
  }
  return `M${x},${y0} V${y1 - rr} Q${x},${y1} ${x + rr},${y1} H${x + w - rr} Q${x + w},${y1} ${x + w},${y1 - rr} V${y0} Z`;
}

/** حالة فارغة هادئة: جملة واحدة في مساحة المخطط نفسها */
function EmptyChart({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center px-6 text-center">
      <p className="text-[16.5px] font-medium text-ink">{title}</p>
      <p className="mt-1 max-w-xs text-[15.5px] leading-relaxed text-slate-600">{hint}</p>
    </div>
  );
}

function Tooltip({ children, style }: { children: React.ReactNode; style: React.CSSProperties }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.14 }}
      className="pointer-events-none absolute z-20 min-w-44 rounded-lg bg-white p-3 text-[15.5px] text-ink shadow-lift"
      style={style}
    >
      {children}
    </motion.div>
  );
}

function TipRow({ color, label, value, suffix, strong }: { color?: string; label: string; value: string; suffix?: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-0.5">
      <span className="flex items-center gap-1.5 text-slate-600">
        {color && <span className="size-2.5 rounded-[3px]" style={{ background: color }} />}
        {label}
      </span>
      <span className={`num ${strong ? "font-semibold" : ""}`}>
        {value}
        {suffix && <span className="ms-1 text-slate-500">{suffix}</span>}
      </span>
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
// خط صغير داخل بطاقة الإحصاء (اتجاه آخر 6 أشهر) مع قيمة الشهر عند المرور
// =============================================================================
export function Sparkline({ values, months, color, currency }: { values: number[]; months: string[]; color: string; currency: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, W] = useWidth<HTMLDivElement>(160);
  if (values.length < 2 || values.every((v) => v === 0)) return <div className="h-10" />;
  const H = 40, pad = 3;
  const lo = Math.min(...values, 0), hi = Math.max(...values, 0);
  const x = (i: number) => pad + ((W - pad * 2) * i) / (values.length - 1);
  const y = (v: number) => pad + ((hi - v) / (hi - lo || 1)) * (H - pad * 2);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${d} L${x(values.length - 1)},${y(Math.max(lo, 0))} L${x(0)},${y(Math.max(lo, 0))} Z`;
  return (
    <div ref={ref} className="relative h-10" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-10 w-full overflow-visible" aria-hidden>
        <path d={area} fill={color} fillOpacity={0.1} className="animate-fade" style={{ animationDelay: "0.5s" }} />
        <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" pathLength={1} strokeDasharray="1" className="animate-draw" />
        {values.map((v, i) => (
          <g key={i}>
            {(hover === i || (hover === null && i === values.length - 1)) && (
              <circle cx={x(i)} cy={y(v)} r={3.5} fill={color} stroke="#fff" strokeWidth="2" />
            )}
            <rect x={x(i) - (W / values.length) / 2} y={0} width={W / values.length} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
          </g>
        ))}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute -top-8 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg bg-ink px-2 py-1 text-[14.5px] text-white"
          style={{ left: `${(x(hover) / W) * 100}%` }}>
          {monthLabel(months[hover]!, true)}: <span className="num">{compact(values[hover]!)}</span> {currency}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// الإيرادات والمصروفات: أعمدة مجمّعة لكل شهر + خط صافي النتيجة، بنفس المحور
// المفتاح يُخفي/يُظهر السلاسل (اللون يتبع السلسلة دائمًا)
// =============================================================================
type SeriesKey = "revenue" | "expenses" | "net";

export function IncomeExpenseChart({
  data, currency, labels,
}: {
  data: { month: string; revenue: number; expenses: number }[];
  currency: string;
  labels: { revenue: string; expenses: string; net: string };
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [shown, setShown] = useState<Record<SeriesKey, boolean>>({ revenue: true, expenses: true, net: true });
  const [boxRef, W] = useWidth<HTMLDivElement>(560);
  if (!data.some((d) => d.revenue !== 0 || d.expenses !== 0)) {
    return <EmptyChart title="لا توجد حركات مرحّلة بعد" hint="يُرسم المخطط من القيود المرحّلة في الأستاذ العام تلقائيًا." />;
  }
  const rows = data.map((d) => ({ ...d, net: d.revenue - d.expenses }));
  const H = 260, padT = 16, padB = 30, axisW = 44;
  const plotW = W - axisW, plotH = H - padT - padB;
  const vals = rows.flatMap((d) => [shown.revenue ? d.revenue : 0, shown.expenses ? d.expenses : 0, shown.net ? d.net : 0]);
  const scale = niceScale(Math.min(0, ...vals) * 1.05, Math.max(0, ...vals) * 1.08);
  const y = (v: number) => padT + ((scale.hi - v) / (scale.hi - scale.lo)) * plotH;
  const band = plotW / rows.length;
  // RTL: الشهر الأحدث يسارًا كما يُقرأ المحور الزمني في الواجهة العربية
  const cx = (i: number) => W - axisW - band * (i + 0.5);
  const barW = Math.min(22, band * 0.28);
  const gap = 2;
  const y0 = y(0);
  const netPts = rows.map((d, i) => ({ x: cx(i), y: y(d.net) }));
  const netPath = netPts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const h = hover !== null ? rows[hover] : undefined;
  const toggle = (k: SeriesKey) => setShown((s) => ({ ...s, [k]: !s[k] }));
  const series: { key: SeriesKey; label: string; color: string; line?: boolean }[] = [
    { key: "revenue", label: labels.revenue, color: CHART_COLORS.revenue },
    { key: "expenses", label: labels.expenses, color: CHART_COLORS.expenses },
    { key: "net", label: labels.net, color: CHART_COLORS.net, line: true },
  ];

  return (
    <div className="space-y-4" data-chart="financial">
      {/* المفتاح (أزرار إظهار/إخفاء) */}
      <div className="flex flex-wrap items-center gap-2 text-[15.5px]">
        {series.map((s) => (
          <button key={s.key} type="button" onClick={() => toggle(s.key)} aria-pressed={shown[s.key]}
            className={`flex items-center gap-2 rounded-md px-2.5 py-1 transition-colors ${shown[s.key] ? "bg-subtle text-ink" : "text-slate-500 line-through"}`}>
            {s.line ? <span className="h-0.5 w-3.5 rounded-full" style={{ background: s.color }} /> : <span className="size-2.5 rounded-[3px]" style={{ background: s.color }} />}
            {s.label}
          </button>
        ))}
        <span className="ms-auto text-slate-500">المبالغ بـ {currency}</span>
      </div>

      <div ref={boxRef} className="relative" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="h-[260px] w-full overflow-visible" role="img" aria-label={`${labels.revenue} / ${labels.expenses} / ${labels.net}`}>
          {scale.ticks.map((v, k) => (
            <g key={k}>
              <line x1={0} x2={W - axisW} y1={y(v)} y2={y(v)} stroke={v === 0 ? "#cfccc3" : GRID} strokeDasharray={v === 0 ? undefined : "3 5"} />
              <text x={W - axisW + 8} y={y(v) + 4} fill={AXIS_TEXT} fontSize="14" textAnchor="start">{compact(v)}</text>
            </g>
          ))}
          {rows.map((d, i) => (
            <g key={d.month}>
              {hover === i && <rect x={cx(i) - band / 2 + 4} y={padT - 6} width={band - 8} height={plotH + 12} rx={10} fill="#f1f0ec" />}
              {shown.revenue && (
                <motion.path d={barPath(cx(i) + gap / 2, barW, y0, y(d.revenue))} fill={CHART_COLORS.revenue}
                  initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ duration: 0.7, delay: 0.1 + i * 0.06, ease: [0.16, 1, 0.3, 1] }}
                  style={{ transformOrigin: `0px ${y0}px`, transformBox: "view-box" }} opacity={hover === null || hover === i ? 1 : 0.45} />
              )}
              {shown.expenses && (
                <motion.path d={barPath(cx(i) - gap / 2 - barW, barW, y0, y(d.expenses))} fill={CHART_COLORS.expenses}
                  initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ duration: 0.7, delay: 0.16 + i * 0.06, ease: [0.16, 1, 0.3, 1] }}
                  style={{ transformOrigin: `0px ${y0}px`, transformBox: "view-box" }} opacity={hover === null || hover === i ? 1 : 0.45} />
              )}
              <text x={cx(i)} y={H - 8} textAnchor="middle" fill={hover === i ? "#312f2e" : AXIS_TEXT} fontSize="14" fontWeight={hover === i ? 600 : 400}>
                {monthLabel(d.month, true)}
              </text>
            </g>
          ))}
          {shown.net && (
            <>
              <path d={netPath} fill="none" stroke={CHART_COLORS.net} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
                pathLength={1} strokeDasharray="1" className="animate-draw" style={{ animationDelay: "0.5s" }} />
              {netPts.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={hover === i ? 5.5 : 4} fill={CHART_COLORS.net} stroke="#fff" strokeWidth="2"
                  className="animate-pop" style={{ animationDelay: `${0.9 + i * 0.05}s` }} />
              ))}
            </>
          )}
          {rows.map((d, i) => (
            <rect key={`hit-${d.month}`} x={cx(i) - band / 2} y={0} width={band} height={H} fill="transparent" className="cursor-pointer"
              onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
          ))}
        </svg>
        <AnimatePresence>
          {h && hover !== null && (
            <Tooltip key={hover} style={{ top: 0, left: `${Math.min(Math.max((cx(hover) / W) * 100, 16), 84)}%`, transform: "translateX(-50%)" }}>
              <p className="mb-1.5 font-semibold">{monthLabel(h.month)}</p>
              <TipRow color={CHART_COLORS.revenue} label={labels.revenue} value={fmt(h.revenue, 2)} />
              <TipRow color={CHART_COLORS.expenses} label={labels.expenses} value={fmt(h.expenses, 2)} />
              <div className="mt-1.5 border-t border-line pt-1.5">
                <TipRow color={CHART_COLORS.net} label={labels.net} value={fmt(h.net, 2)} suffix={currency} strong />
                {h.revenue > 0 && <TipRow label="هامش الربح" value={`${fmt((h.net / h.revenue) * 100, 1)}%`} />}
              </div>
            </Tooltip>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// =============================================================================
// دائرة (Donut) بحصص الأجزاء وفواصل 2px، والمركز يعرض الجزء عند المرور
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
  const [active, setActive] = useState<string | null>(null);
  const items = segments.filter((s) => s.value > 0);
  const total = items.reduce((s, x) => s + x.value, 0);
  if (!items.length || total <= 0) return <EmptyChart title={emptyTitle} hint={emptyHint} />;

  const size = 188, c = size / 2, r = 70, sw = 22, circ = 2 * Math.PI * r;
  const gap = items.length > 1 ? 4 : 0;
  const a = items.find((x) => x.label === active);

  return (
    <div className="@container" data-chart="donut">
      <div className="flex flex-col items-center gap-5 @sm:flex-row @sm:justify-center @sm:gap-10">
        <div className="relative shrink-0">
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
            <circle cx={c} cy={c} r={r} fill="none" stroke="#f1f0ec" strokeWidth={sw} />
            {items.map((s, i) => {
              const before = items.slice(0, i).reduce((acc, x) => acc + x.value, 0) / total;
              const len = Math.max((s.value / total) * circ - gap, 0.5);
              return (
                <circle
                  key={s.label}
                  cx={c} cy={c} r={r} fill="none" stroke={s.color}
                  strokeDasharray={`${len} ${circ}`}
                  strokeDashoffset={-before * circ}
                  strokeWidth={active === s.label ? sw + 8 : sw}
                  strokeLinecap="butt"
                  opacity={active && active !== s.label ? 0.35 : 1}
                  onMouseEnter={() => setActive(s.label)} onMouseLeave={() => setActive(null)}
                  className="donut-seg cursor-pointer transition-opacity"
                  style={{ ["--circ" as string]: circ, animationDelay: `${0.15 + i * 0.12}s` }}
                />
              );
            })}
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="max-w-24 truncate text-[15.5px] text-slate-600">{a ? a.label : centerTitle}</span>
            <span key={a?.label ?? "total"} className="animate-pop num text-[26px] font-bold text-ink">
              {a ? `${fmt((a.value / total) * 100, 0)}%` : centerValue}
            </span>
            {a && <span className="num text-[14.5px] text-slate-600">{a.display ?? fmt(a.value)}</span>}
          </div>
        </div>
        <ul className="w-full space-y-1 text-[16.5px] @sm:w-52">
          {segments.map((s) => {
            const share = total > 0 ? (s.value / total) * 100 : 0;
            return (
              <li key={s.label}>
                <button type="button" onMouseEnter={() => setActive(s.label)} onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(s.label)} onBlur={() => setActive(null)}
                  className={`w-full rounded-lg px-2.5 py-1.5 text-start transition-colors ${active === s.label ? "bg-subtle" : ""} ${s.value > 0 ? "" : "opacity-50"}`}>
                  <span className="flex items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: s.color }} />
                    <span className="text-slate-700">{s.label}</span>
                    <span className="num ms-auto font-semibold text-ink">{s.display ?? fmt(s.value)}</span>
                    {valueSuffix && <span className="text-slate-500">{valueSuffix}</span>}
                  </span>
                  <span className="mt-1 block h-1 overflow-hidden rounded-sm bg-subtle">
                    <span className="animate-grow-x block h-full rounded-sm" style={{ width: `${share}%`, background: s.color, transformOrigin: "right" }} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

// =============================================================================
// أشرطة أفقية مع تلميح (أعمار الذمم، الإيرادات حسب القسم)
// =============================================================================
export function StripedBars({
  rows, currency, emptyTitle, emptyHint,
}: {
  rows: { label: string; count: number; amount: number; amountText: string; color: string }[];
  currency: string;
  emptyTitle: string;
  emptyHint: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...rows.map((r) => r.amount), 0);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  if (max <= 0) return <EmptyChart title={emptyTitle} hint={emptyHint} />;
  return (
    <div className="space-y-3.5" data-chart="bars" onMouseLeave={() => setHover(null)}>
      {rows.map((r, i) => (
        <div key={r.label} className="relative" onMouseEnter={() => setHover(i)}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[16.5px]">
            <span className="text-slate-700">{r.label}</span>
            <span>
              <span className="num font-semibold text-ink">{r.amountText}</span>
              <span className="ms-1 text-[14.5px] text-slate-500">{currency}</span>
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-sm bg-subtle">
            <div
              className="animate-grow-x h-full rounded-sm transition-opacity"
              style={{
                width: `${Math.max((r.amount / max) * 100, r.amount > 0 ? 2 : 0)}%`,
                backgroundColor: r.color,
                transformOrigin: "right",
                animationDelay: `${0.1 + i * 0.08}s`,
                opacity: hover === null || hover === i ? 1 : 0.4,
              }}
            />
          </div>
          <AnimatePresence>
            {hover === i && r.amount > 0 && (
              <Tooltip style={{ top: -8, left: 0, transform: "translateY(-100%)" }}>
                <p className="mb-1 font-semibold">{r.label}</p>
                <TipRow label="المبلغ" value={r.amountText} suffix={currency} strong />
                {r.count > 0 && <TipRow label="عدد المستندات" value={fmt(r.count)} />}
                <TipRow label="الحصة" value={`${fmt((r.amount / total) * 100, 1)}%`} />
              </Tooltip>
            )}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}
