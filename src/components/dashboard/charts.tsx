"use client";

import { useState } from "react";
import { TrendingUp, Layers, BarChart3, Activity, PieChart as PieIcon } from "lucide-react";

/**
 * مخططات لوحة التحكم (SVG خفيف بلا مكتبات). كل القيم تأتي من الأستاذ العام والدفاتر الفرعية
 * كما هي — لا تقدير ولا تقريب في البيانات؛ التقريب للعرض فقط.
 * يدعم المخطط المالي القيم السالبة (صافي خسارة) دون قصّها إلى صفر.
 */

const fmt = (v: number, digits = 0) =>
  new Intl.NumberFormat("ar-SA-u-nu-latn", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);

/** اختصار المحاور: 12.5k / 1.2M */
const compact = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${fmt(v / 1_000_000, 1)}M`;
  if (a >= 1_000) return `${fmt(v / 1_000, a >= 10_000 ? 0 : 1)}k`;
  return fmt(v);
};

const PALETTE = ["#FFD369", "#222831", "#D97706", "#393E46", "#059669", "#64748B", "#475569", "#B45309"];

const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
/** "2026-09" ⇒ "سبتمبر 2026" (السنة لتمييز الأشهر عبر نهاية السنة) */
export function monthLabel(m: string, withYear = true): string {
  const [y, mo] = m.split("-");
  const name = MONTHS[parseInt(mo ?? "1", 10) - 1] ?? m;
  return withYear && y ? `${name} ${y}` : name;
}

/**
 * مسار خطي بين النقاط. عمدًا بلا تنعيم: المنحنيات الناعمة تتجاوز القيم الفعلية
 * (قد تُظهر خسارة أو سعرًا سالبًا لم يحدث). النقاط null تقطع الخط (شهر بلا بيانات).
 */
function linePath(pts: ({ x: number; y: number } | null)[]): string {
  let d = "";
  let pen = false;
  for (const p of pts) {
    if (!p) { pen = false; continue; }
    d += `${pen ? " L" : " M"} ${p.x} ${p.y}`;
    pen = true;
  }
  return d.trim();
}

function EmptyChart({ icon: Icon, title, hint }: { icon: typeof Activity; title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#CBD5E1] bg-[#F8FAF9]/60 px-4 py-12 text-center">
      <div className="mb-3 flex size-11 items-center justify-center rounded-2xl bg-[#222831] text-[#FFD369] shadow-xs">
        <Icon className="size-5" />
      </div>
      <p className="text-sm font-bold text-[#0F172A]">{title}</p>
      <p className="mt-1 max-w-sm text-xs text-[#64748B]">{hint}</p>
    </div>
  );
}

// =============================================================================
// الإيرادات مقابل المصروفات + صافي النتيجة (شهري)
// =============================================================================
export interface FinancialDataPoint {
  month: string;
  revenue: number;
  expenses: number;
}

export function ExecutiveFinancialChart({
  data,
  labels,
  currency,
}: {
  data: FinancialDataPoint[];
  labels: { revenue: string; expenses: string; net: string };
  currency: string;
}) {
  const [viewMode, setViewMode] = useState<"composed" | "area" | "bar">("composed");
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const hasData = data.some((d) => d.revenue !== 0 || d.expenses !== 0);
  if (!hasData) {
    return (
      <EmptyChart
        icon={Activity}
        title="لا توجد حركات مالية مرحّلة في الفترة"
        hint="يظهر المخطط تلقائيًا من القيود المرحّلة في الأستاذ العام (فوليو، فواتير، سندات، قيود يدوية...)."
      />
    );
  }

  const rows = data.map((d) => ({ ...d, net: d.revenue - d.expenses }));
  const top = Math.max(...rows.map((d) => Math.max(d.revenue, d.expenses, d.net)), 0);
  const bottom = Math.min(...rows.map((d) => Math.min(d.net, 0)), 0);
  const span = top - bottom || 1;
  const maxVal = top + span * 0.12;
  const minVal = bottom < 0 ? bottom - span * 0.08 : 0;

  const W = 720, H = 270, padL = 16, padR = 70, padT = 24, padB = 40;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const slot = plotW / rows.length;
  const xAt = (i: number) => padL + slot * (i + 0.5);
  const yAt = (v: number) => padT + ((maxVal - v) / (maxVal - minVal)) * plotH;
  const y0 = yAt(0);

  const ptsRev = rows.map((d, i) => ({ x: xAt(i), y: yAt(d.revenue) }));
  const ptsExp = rows.map((d, i) => ({ x: xAt(i), y: yAt(d.expenses) }));
  const ptsNet = rows.map((d, i) => ({ x: xAt(i), y: yAt(d.net) }));
  const area = (pts: { x: number; y: number }[]) =>
    `${linePath(pts)} L ${pts[pts.length - 1]!.x} ${y0} L ${pts[0]!.x} ${y0} Z`;

  const ticks = Array.from({ length: 5 }, (_, k) => minVal + ((maxVal - minVal) * k) / 4);
  const active = rows[hoveredIdx ?? rows.length - 1]!;
  const barW = Math.min(22, slot / 3.2);

  const modes = [
    { key: "composed" as const, label: "مركّب", icon: TrendingUp },
    { key: "area" as const, label: "مساحي", icon: Layers },
    { key: "bar" as const, label: "أعمدة", icon: BarChart3 },
  ];

  return (
    <div className="space-y-4" data-chart="financial">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8F0] pb-3">
        <div className="grid grid-cols-3 gap-4 text-[11px]">
          <div>
            <p className="font-semibold text-[#64748B]">{labels.revenue} — {monthLabel(active.month)}</p>
            <p className="num text-sm font-black text-[#0F172A]">{fmt(active.revenue, 2)} <span className="text-[10px] text-[#64748B]">{currency}</span></p>
          </div>
          <div>
            <p className="font-semibold text-[#64748B]">{labels.expenses}</p>
            <p className="num text-sm font-black text-[#0F172A]">{fmt(active.expenses, 2)} <span className="text-[10px] text-[#64748B]">{currency}</span></p>
          </div>
          <div>
            <p className="font-semibold text-[#64748B]">{labels.net}</p>
            <p className={`num text-sm font-black ${active.net < 0 ? "text-[#D97706]" : "text-[#059669]"}`}>
              {fmt(active.net, 2)} <span className="text-[10px] text-[#64748B]">{currency}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center rounded-xl border border-[#CBD5E1] bg-[#F1F5F9] p-1 shadow-2xs">
          {modes.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setViewMode(m.key)}
              className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold transition-all ${
                viewMode === m.key ? "bg-[#222831] text-[#FFD369] shadow-xs" : "text-[#64748B] hover:text-[#0F172A]"
              }`}
            >
              <m.icon className="size-3" />
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative w-full overflow-hidden rounded-xl border border-[#E2E8F0] bg-[#F8FAF9]/50 p-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-[270px] w-full select-none overflow-visible" role="img" aria-label={`${labels.revenue} / ${labels.expenses}`}>
          <defs>
            <linearGradient id="goldAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FFD369" stopOpacity="0.6" />
              <stop offset="95%" stopColor="#FFD369" stopOpacity="0.04" />
            </linearGradient>
            <linearGradient id="darkAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#222831" stopOpacity="0.45" />
              <stop offset="95%" stopColor="#222831" stopOpacity="0.02" />
            </linearGradient>
            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#222831" floodOpacity="0.25" />
            </filter>
          </defs>

          {ticks.map((v, k) => (
            <g key={k}>
              <line x1={padL} y1={yAt(v)} x2={W - padR} y2={yAt(v)} stroke="#E2E8F0" strokeDasharray="4 4" />
              <text x={W - padR + 10} y={yAt(v) + 4} fill="#64748B" fontSize="10.5" fontWeight="600">{compact(v)}</text>
            </g>
          ))}
          {minVal < 0 && <line x1={padL} y1={y0} x2={W - padR} y2={y0} stroke="#64748B" strokeWidth="1" />}

          {rows.map((_, i) => (
            <rect
              key={`hit-${i}`}
              x={xAt(i) - slot / 2}
              y={padT}
              width={slot}
              height={plotH}
              fill="#222831"
              fillOpacity={hoveredIdx === i ? 0.04 : 0}
              rx="8"
              className="cursor-pointer"
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
            />
          ))}

          {viewMode === "area" && (
            <g className="pointer-events-none">
              <path d={area(ptsRev)} fill="url(#goldAreaGrad)" />
              <path d={linePath(ptsRev)} fill="none" stroke="#FFD369" strokeWidth="3.5" />
              <path d={area(ptsExp)} fill="url(#darkAreaGrad)" />
              <path d={linePath(ptsExp)} fill="none" stroke="#222831" strokeWidth="2.5" />
            </g>
          )}

          {(viewMode === "composed" || viewMode === "bar") && (
            <g className="pointer-events-none">
              {rows.map((d, i) => {
                const cx = xAt(i);
                const revTop = Math.min(yAt(d.revenue), y0);
                const expTop = Math.min(yAt(d.expenses), y0);
                return (
                  <g key={i}>
                    <rect x={cx - barW - 2} y={revTop} width={barW} height={Math.abs(y0 - yAt(d.revenue))} fill="#FFD369" rx="5"
                      filter={hoveredIdx === i ? "url(#glow)" : undefined} />
                    <rect x={cx + 2} y={expTop} width={barW} height={Math.abs(y0 - yAt(d.expenses))} fill="#222831" rx="5" />
                  </g>
                );
              })}
            </g>
          )}

          {viewMode === "composed" && (
            <g className="pointer-events-none">
              <path d={linePath(ptsNet)} fill="none" stroke="#059669" strokeWidth="3" strokeDasharray="3 3" />
              {ptsNet.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={hoveredIdx === i ? 6 : 4} fill={rows[i]!.net < 0 ? "#D97706" : "#059669"} stroke="#FFFFFF" strokeWidth="2" />
              ))}
            </g>
          )}

          {rows.map((d, i) => (
            <text key={`x-${i}`} x={xAt(i)} y={H - 12} textAnchor="middle" fill={hoveredIdx === i ? "#0F172A" : "#64748B"}
              fontSize="11" fontWeight={hoveredIdx === i ? 800 : 600}>
              {monthLabel(d.month)}
            </text>
          ))}
        </svg>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-6 border-t border-[#E2E8F0]/60 pt-1 text-xs">
        <Legend color="bg-[#FFD369]" label={labels.revenue} />
        <Legend color="bg-[#222831]" label={labels.expenses} />
        {viewMode === "composed" && <Legend color="bg-[#059669]" label={labels.net} />}
        <span className="text-[10.5px] text-[#64748B]">المبالغ بـ {currency}</span>
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`size-3 rounded-md shadow-xs ${color}`} />
      <span className="font-bold text-[#0F172A]">{label}</span>
    </div>
  );
}

// =============================================================================
// توزيع الإيرادات على الأقسام (مراكز الإيراد)
// =============================================================================
export function ExecutiveDepartmentDonut({
  data, currency, ledgerTotal, note,
}: {
  data: { name: string; value: number }[];
  currency: string;
  /** إجمالي إيراد الفترة في الأستاذ العام — للتحقق من أن توزيع الأقسام يغطيه بالكامل */
  ledgerTotal: number;
  note?: string;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const items = data.filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
  const total = items.reduce((s, d) => s + d.value, 0);

  if (items.length === 0 || total <= 0) {
    return (
      <EmptyChart
        icon={PieIcon}
        title="لا توجد إيرادات أقسام هذا الشهر"
        hint="تُوزَّع الإيرادات تلقائيًا حسب القسم المسجّل على رمز الإيراد أو بند القيد."
      />
    );
  }

  const size = 200, c = size / 2, r = 78, sw = 24, circ = 2 * Math.PI * r;
  const segs = items.map((d, i) => {
    const f = d.value / total;
    const before = items.slice(0, i).reduce((s, x) => s + x.value, 0) / total;
    return { ...d, color: PALETTE[i % PALETTE.length]!, dash: `${f * circ} ${circ}`, offset: -before * circ, pct: (f * 100).toFixed(1) };
  });
  const active = hoveredIndex !== null ? segs[hoveredIndex] : undefined;

  return (
    <div className="flex flex-col gap-4" data-chart="departments">
      <div className="relative flex items-center justify-center py-2">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="rotate-[-90deg] select-none">
          <circle cx={c} cy={c} r={r} fill="transparent" stroke="#F1F5F9" strokeWidth={sw} />
          {segs.map((s, i) => (
            <circle key={i} cx={c} cy={c} r={r} fill="transparent" stroke={s.color}
              strokeWidth={hoveredIndex === i ? sw + 4 : sw} strokeDasharray={s.dash} strokeDashoffset={s.offset}
              className="cursor-pointer transition-all duration-300"
              onMouseEnter={() => setHoveredIndex(i)} onMouseLeave={() => setHoveredIndex(null)} />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="max-w-[110px] truncate text-[10px] font-bold text-[#64748B]">{active ? active.name : "إجمالي إيراد الأقسام"}</span>
          <span className="num text-sm font-extrabold text-[#0F172A]">{active ? `${active.pct}%` : fmt(total, 2)}</span>
          <span className="text-[10px] font-bold text-[#059669]">{active ? `${fmt(active.value, 2)} ${currency}` : currency}</span>
        </div>
      </div>
      <div className="scrollbar-thin max-h-[170px] space-y-2 overflow-y-auto pe-1">
        {segs.map((d, i) => (
          <div key={i} onMouseEnter={() => setHoveredIndex(i)} onMouseLeave={() => setHoveredIndex(null)}
            className={`flex cursor-pointer items-center justify-between rounded-xl border px-3 py-2 text-xs transition-all ${
              hoveredIndex === i ? "border-[#FFD369] bg-white shadow-xs" : "border-[#E2E8F0] bg-[#F8FAF9] hover:bg-white"
            }`}>
            <div className="flex min-w-0 items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: d.color }} />
              <span className="truncate font-bold text-[#0F172A]">{d.name}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2.5">
              <span className="num font-extrabold text-[#0F172A]">{fmt(d.value, 2)}</span>
              <span className={`rounded-lg px-1.5 py-0.5 text-[10px] font-extrabold ${
                hoveredIndex === i ? "bg-[#222831] text-[#FFD369]" : "border border-[#CBD5E1] bg-white text-[#222831]"
              }`}>{d.pct}%</span>
            </div>
          </div>
        ))}
      </div>
      <div className="space-y-1 border-t border-[#E2E8F0] pt-2 text-[10.5px] text-[#64748B]">
        <p>
          إجمالي إيراد الشهر في الأستاذ العام: <span className="num font-bold text-[#0F172A]">{fmt(ledgerTotal, 2)}</span> {currency}
        </p>
        {note && <p className="text-[#D97706]">{note}</p>}
      </div>
    </div>
  );
}

// =============================================================================
// اتجاه مؤشرات الغرف شهريًا (من إحصاءات الغرف الفعلية لكل شهر)
// =============================================================================
export interface RoomTrendPoint {
  month: string;
  adr: number | null;
  revpar: number | null;
  occupancy: number | null;
  nights: number;
}

export function HotelKpiTrendChart({ data, currency }: { data: RoomTrendPoint[]; currency: string }) {
  const hasData = data.some((d) => d.nights > 0);
  if (!hasData) {
    return (
      <EmptyChart
        icon={TrendingUp}
        title="لا توجد ليالٍ مباعة في الفترة"
        hint="تُحسب ADR وRevPAR والإشغال من رسوم فئة «غرف» المرحّلة على الفوليو وعدد الغرف في إعدادات الفندق."
      />
    );
  }

  const W = 500, H = 190, padL = 16, padR = 60, padT = 18, padB = 44;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const maxVal = Math.max(...data.map((d) => Math.max(d.adr ?? 0, d.revpar ?? 0)), 1) * 1.2;
  const slot = plotW / data.length;
  const xAt = (i: number) => padL + slot * (i + 0.5);
  const yAt = (v: number) => padT + plotH - (v / maxVal) * plotH;
  const ptsAdr = data.map((d, i) => (d.adr === null ? null : { x: xAt(i), y: yAt(d.adr) }));
  const ptsRev = data.map((d, i) => (d.revpar === null ? null : { x: xAt(i), y: yAt(d.revpar) }));

  return (
    <div className="space-y-3" data-chart="rooms">
      <div className="w-full overflow-hidden rounded-xl border border-[#E2E8F0] bg-[#F8FAF9]/60 p-1.5">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-[190px] w-full select-none overflow-visible" role="img" aria-label="ADR / RevPAR">
          
          {[0, maxVal / 2, maxVal].map((v, k) => (
            <g key={k}>
              <line x1={padL} y1={yAt(v)} x2={W - padR} y2={yAt(v)} stroke="#E2E8F0" strokeDasharray="3 3" />
              <text x={W - padR + 8} y={yAt(v) + 3} fill="#64748B" fontSize="9.5" fontWeight="600">{compact(v)}</text>
            </g>
          ))}
          <path d={linePath(ptsAdr)} fill="none" stroke="#FFD369" strokeWidth="2.5" />
          <path d={linePath(ptsRev)} fill="none" stroke="#222831" strokeWidth="2" />
          {data.map((d, i) => (
            <g key={i}>
              {ptsAdr[i] && <circle cx={ptsAdr[i].x} cy={ptsAdr[i].y} r={3.5} fill="#FFD369" stroke="#222831" strokeWidth="1.5" />}
              {ptsRev[i] && <circle cx={ptsRev[i].x} cy={ptsRev[i].y} r={3.5} fill="#222831" stroke="#FFFFFF" strokeWidth="1.5" />}
              <text x={xAt(i)} y={H - 24} textAnchor="middle" fill="#64748B" fontSize="10" fontWeight="600">{monthLabel(d.month)}</text>
              <text x={xAt(i)} y={H - 8} textAnchor="middle" fill="#0F172A" fontSize="9.5" fontWeight="700">
                {d.occupancy === null ? "—" : `${fmt(d.occupancy, 1)}%`}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-5 border-t border-[#E2E8F0] pt-2 text-xs">
        <Legend color="bg-[#FFD369]" label="ADR" />
        <Legend color="bg-[#222831]" label="RevPAR" />
        <span className="text-[10.5px] text-[#64748B]">الرقم أسفل كل شهر = نسبة الإشغال • المبالغ بـ {currency}</span>
      </div>
    </div>
  );
}
