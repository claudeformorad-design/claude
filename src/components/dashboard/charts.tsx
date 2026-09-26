"use client";

import { useState } from "react";
import { TrendingUp, Layers, PieChart as PieIcon, Activity, PlusCircle } from "lucide-react";
import Link from "@/components/link";

const fmtNumber = (v: number) =>
  new Intl.NumberFormat("ar-SA-u-nu-latn", { maximumFractionDigits: 0 }).format(v);

// Executive Palette conforming to the luxury design spec
const PALETTE = [
  "#FFD369", // Warm Gold
  "#222831", // Executive Charcoal
  "#D97706", // Deep Amber
  "#393E46", // Graphite Slate
  "#059669", // Emerald
  "#64748B", // Cool Slate
  "#475569", // Slate Dark
  "#B45309", // Warm Bronze
];

export interface FinancialDataPoint {
  month: string;
  revenue: number;
  expenses: number;
}

// Convert month string "2026-04" to Arabic friendly name
function formatMonthName(m: string): string {
  const parts = m.split("-");
  const monthNum = parseInt(parts[1] || "1", 10);
  const arabicMonths = [
    "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
    "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"
  ];
  return arabicMonths[monthNum - 1] ?? m;
}

export function ExecutiveFinancialChart({
  data,
  labels,
}: {
  data: FinancialDataPoint[];
  labels: { revenue: string; expenses: string };
}) {
  const [viewMode, setViewMode] = useState<"composed" | "area" | "bar">("composed");
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const hasData = data && data.length > 0 && data.some((d) => d.revenue > 0 || d.expenses > 0);

  if (!hasData) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center rounded-2xl border border-dashed border-[#CBD5E1] bg-[#F8FAF9]/60">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-[#222831] text-[#FFD369] shadow-xs mb-3">
          <Activity className="size-6" />
        </div>
        <h4 className="text-sm font-bold text-[#0F172A]">لا توجد حركات مالية مسجلة بعد</h4>
        <p className="text-xs text-[#64748B] max-w-sm mt-1 mb-4">
          تبدأ المخططات البيانية بالظهور تلقائياً وتتبع الإيرادات والمصروفات فور ترحيل أول قيد محاسبي أو تسجيل إيراد.
        </p>
        <Link
          href="/journal"
          className="inline-flex items-center gap-1.5 rounded-xl bg-[#FFD369] px-4 py-2 text-xs font-black text-[#222831] shadow-xs hover:bg-[#F8CA4D] transition-all"
        >
          <PlusCircle className="size-3.5" />
          إضافة قيد يومية الآن
        </Link>
      </div>
    );
  }

  const currentData = data;
  const maxVal = Math.max(...currentData.map((d) => Math.max(d.revenue, d.expenses))) * 1.15 || 10000;

  // Chart dimensions inside SVG viewBox
  const svgWidth = 720;
  const svgHeight = 270;
  const paddingLeft = 40;
  const paddingRight = 75;
  const paddingTop = 25;
  const paddingBottom = 40;
  const plotWidth = svgWidth - paddingLeft - paddingRight;
  const plotHeight = svgHeight - paddingTop - paddingBottom;

  const stepX = plotWidth / Math.max(1, currentData.length - 1);
  const getY = (val: number) => paddingTop + plotHeight - (val / maxVal) * plotHeight;

  // Generate smooth cubic bezier curve points
  const pointsRev = currentData.map((d, i) => ({ x: paddingLeft + i * stepX, y: getY(d.revenue) }));
  const pointsExp = currentData.map((d, i) => ({ x: paddingLeft + i * stepX, y: getY(d.expenses) }));
  const pointsProfit = currentData.map((d, i) => ({ x: paddingLeft + i * stepX, y: getY(Math.max(0, d.revenue - d.expenses)) }));

  const createPathD = (pts: { x: number; y: number }[]) => {
    if (pts.length === 0) return "";
    const first = pts[0] ?? { x: 0, y: 0 };
    let d = `M ${first.x} ${first.y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] ?? pts[i] ?? { x: 0, y: 0 };
      const p1 = pts[i] ?? { x: 0, y: 0 };
      const p2 = pts[i + 1] ?? { x: 0, y: 0 };
      const p3 = pts[i + 2] ?? p2;
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
    }
    return d;
  };

  const pathRev = createPathD(pointsRev);
  const pathExp = createPathD(pointsExp);
  const pathProfit = createPathD(pointsProfit);

  const lastRev = pointsRev[pointsRev.length - 1] ?? { x: 0, y: 0 };
  const firstRev = pointsRev[0] ?? { x: 0, y: 0 };
  const areaRev = `${pathRev} L ${lastRev.x} ${paddingTop + plotHeight} L ${firstRev.x} ${paddingTop + plotHeight} Z`;

  const lastExp = pointsExp[pointsExp.length - 1] ?? { x: 0, y: 0 };
  const firstExp = pointsExp[0] ?? { x: 0, y: 0 };
  const areaExp = `${pathExp} L ${lastExp.x} ${paddingTop + plotHeight} L ${firstExp.x} ${paddingTop + plotHeight} Z`;

  // Grid steps
  const gridTicks = [0, maxVal * 0.25, maxVal * 0.5, maxVal * 0.75, maxVal];

  const activeItem = (hoveredIdx !== null ? currentData[hoveredIdx] : currentData[currentData.length - 1]) ?? currentData[0]!;

  return (
    <div className="space-y-4">
      {/* Controls Bar & Active Summary */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8F0] pb-3">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-xl bg-[#222831] text-[#FFD369] shadow-xs">
            <Activity className="size-4" />
          </div>
          <div>
            <span className="text-xs font-bold text-[#0F172A]">التحليل المالي المقارن</span>
            <span className="text-[11px] text-[#64748B] mr-2">
              (شهر {formatMonthName(activeItem.month)}: إيراد {fmtNumber(activeItem.revenue)} ر.س | ربح {fmtNumber(activeItem.revenue - activeItem.expenses)} ر.س)
            </span>
          </div>
        </div>

        {/* Segmented View Switcher */}
        <div className="flex items-center rounded-xl bg-[#F1F5F9] p-1 shadow-2xs border border-[#CBD5E1]">
          <button
            type="button"
            onClick={() => setViewMode("composed")}
            className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold transition-all ${
              viewMode === "composed" ? "bg-[#222831] text-[#FFD369] shadow-xs" : "text-[#64748B] hover:text-[#0F172A]"
            }`}
          >
            <TrendingUp className="size-3" />
            مركب (شامل)
          </button>
          <button
            type="button"
            onClick={() => setViewMode("area")}
            className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold transition-all ${
              viewMode === "area" ? "bg-[#222831] text-[#FFD369] shadow-xs" : "text-[#64748B] hover:text-[#0F172A]"
            }`}
          >
            <Layers className="size-3" />
            مساحي
          </button>
          <button
            type="button"
            onClick={() => setViewMode("bar")}
            className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold transition-all ${
              viewMode === "bar" ? "bg-[#222831] text-[#FFD369] shadow-xs" : "text-[#64748B] hover:text-[#0F172A]"
            }`}
          >
            <PieIcon className="size-3" />
            أعمدة
          </button>
        </div>
      </div>

      {/* SVG Canvas */}
      <div className="relative w-full overflow-hidden rounded-xl bg-[#F8FAF9]/50 border border-[#E2E8F0] p-2">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full h-[270px] overflow-visible select-none"
        >
          <defs>
            <linearGradient id="goldAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FFD369" stopOpacity="0.65" />
              <stop offset="90%" stopColor="#FFD369" stopOpacity="0.05" />
            </linearGradient>
            <linearGradient id="darkAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#222831" stopOpacity="0.5" />
              <stop offset="90%" stopColor="#222831" stopOpacity="0.02" />
            </linearGradient>
            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#222831" floodOpacity="0.25" />
            </filter>
          </defs>

          {/* Grid lines & Y-axis labels */}
          {gridTicks.map((tVal, idx) => {
            const y = getY(tVal);
            return (
              <g key={idx}>
                <line
                  x1={paddingLeft}
                  y1={y}
                  x2={svgWidth - paddingRight}
                  y2={y}
                  stroke="#E2E8F0"
                  strokeDasharray="4 4"
                  strokeWidth="1"
                />
                <text
                  x={svgWidth - paddingRight + 12}
                  y={y + 4}
                  fill="#64748B"
                  fontSize="10.5"
                  fontWeight="600"
                  textAnchor="start"
                >
                  {tVal >= 1000 ? `${Math.round(tVal / 1000)}k` : tVal} ر.س
                </text>
              </g>
            );
          })}

          {/* Render Areas */}
          {viewMode === "area" && (
            <>
              <path d={areaRev} fill="url(#goldAreaGrad)" />
              <path d={pathRev} fill="none" stroke="#FFD369" strokeWidth="3.5" />
              <path d={areaExp} fill="url(#darkAreaGrad)" />
              <path d={pathExp} fill="none" stroke="#222831" strokeWidth="2.5" />
            </>
          )}

          {/* Render Bars for Composed and Bar modes */}
          {(viewMode === "composed" || viewMode === "bar") && (
            <g>
              {currentData.map((d, i) => {
                const cx = paddingLeft + i * stepX;
                const barWidth = 22;
                const gap = 4;
                const revHeight = (d.revenue / maxVal) * plotHeight;
                const expHeight = (d.expenses / maxVal) * plotHeight;
                const revY = paddingTop + plotHeight - revHeight;
                const expY = paddingTop + plotHeight - expHeight;
                const isHovered = hoveredIdx === i;

                return (
                  <g
                    key={i}
                    className="cursor-pointer transition-opacity"
                    onMouseEnter={() => setHoveredIdx(i)}
                    onMouseLeave={() => setHoveredIdx(null)}
                  >
                    {/* Hover column backdrop */}
                    <rect
                      x={cx - barWidth - 8}
                      y={paddingTop}
                      width={(barWidth + gap) * 2 + 8}
                      height={plotHeight}
                      fill={isHovered ? "#222831" : "transparent"}
                      fillOpacity={isHovered ? "0.04" : "0"}
                      rx="8"
                    />

                    {/* Revenue Bar */}
                    <rect
                      x={cx - barWidth - gap / 2}
                      y={revY}
                      width={barWidth}
                      height={revHeight}
                      fill="#FFD369"
                      rx="6"
                      className="transition-all duration-200"
                      filter={isHovered ? "url(#glow)" : undefined}
                    />

                    {/* Expenses Bar */}
                    <rect
                      x={cx + gap / 2}
                      y={expY}
                      width={barWidth}
                      height={expHeight}
                      fill="#222831"
                      rx="6"
                      className="transition-all duration-200"
                    />

                    {/* Revenue amount text above bar */}
                    {isHovered && (
                      <text
                        x={cx}
                        y={Math.min(revY, expY) - 8}
                        textAnchor="middle"
                        fill="#0F172A"
                        fontSize="10"
                        fontWeight="800"
                      >
                        {fmtNumber(d.revenue)} ر.س
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          )}

          {/* Render GOP Line for Composed Mode */}
          {viewMode === "composed" && (
            <g>
              <path d={pathProfit} fill="none" stroke="#059669" strokeWidth="3" strokeDasharray="3 3" />
              {pointsProfit.map((pt, i) => (
                <circle
                  key={i}
                  cx={pt.x}
                  cy={pt.y}
                  r={hoveredIdx === i ? 6 : 4}
                  fill="#059669"
                  stroke="#FFFFFF"
                  strokeWidth="2"
                  className="transition-all"
                />
              ))}
            </g>
          )}

          {/* X-Axis Labels */}
          {currentData.map((d, i) => {
            const cx = paddingLeft + i * stepX;
            const isHovered = hoveredIdx === i;
            return (
              <g key={i}>
                <text
                  x={cx}
                  y={svgHeight - 12}
                  textAnchor="middle"
                  fill={isHovered ? "#0F172A" : "#64748B"}
                  fontSize="11"
                  fontWeight={isHovered ? "800" : "600"}
                >
                  {formatMonthName(d.month)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Modern Legend Bar */}
      <div className="flex flex-wrap items-center justify-center gap-6 pt-1 border-t border-[#E2E8F0]/60 text-xs">
        <div className="flex items-center gap-2">
          <span className="size-3.5 rounded-md bg-[#FFD369] shadow-xs" />
          <span className="font-bold text-[#0F172A]">{labels.revenue}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="size-3.5 rounded-md bg-[#222831] shadow-xs" />
          <span className="font-bold text-[#0F172A]">{labels.expenses}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="size-3.5 rounded-md bg-[#059669] shadow-xs" />
          <span className="font-bold text-[#0F172A]">صافي الربح التشغيلي (GOP)</span>
        </div>
      </div>
    </div>
  );
}

export function ExecutiveDepartmentDonut({
  data,
}: {
  data: { name: string; value: number }[];
}) {
  const currentData = data.filter((d) => d.value > 0);
  const total = currentData.reduce((acc, curr) => acc + curr.value, 0);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (currentData.length === 0 || total === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center rounded-2xl border border-dashed border-[#CBD5E1] bg-[#F8FAF9]/60">
        <div className="flex size-10 items-center justify-center rounded-xl bg-[#222831] text-[#FFD369] mb-2">
          <PieIcon className="size-5" />
        </div>
        <p className="text-xs font-bold text-[#0F172A]">لا توجد إيرادات أقسام مسجلة</p>
        <p className="text-[11px] text-[#64748B] mt-0.5">سيتم تصنيف الإيرادات حسب الأقسام (الغرف، المطاعم، السبا) فور تسجيلها.</p>
      </div>
    );
  }

  // Calculate SVG donut segments
  const size = 200;
  const center = size / 2;
  const radius = 78;
  const strokeWidth = 24;
  const circumference = 2 * Math.PI * radius;

  const segments = currentData.map((d, i) => {
    const fraction = d.value / total;
    const priorFraction = currentData.slice(0, i).reduce((acc, curr) => acc + curr.value / total, 0);
    const strokeDasharray = `${fraction * circumference} ${circumference}`;
    const strokeDashoffset = -priorFraction * circumference;
    const color = PALETTE[i % PALETTE.length] ?? "#FFD369";
    return {
      ...d,
      color,
      fraction,
      strokeDasharray,
      strokeDashoffset,
      percentage: (fraction * 100).toFixed(1),
    };
  });

  const activeSegment = hoveredIndex !== null ? (segments[hoveredIndex] ?? null) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="relative flex items-center justify-center py-2">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="rotate-[-90deg] select-none">
          {/* Background Ring */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="transparent"
            stroke="#F1F5F9"
            strokeWidth={strokeWidth}
          />

          {/* Donut Segments */}
          {segments.map((seg, i) => (
            <circle
              key={i}
              cx={center}
              cy={center}
              r={radius}
              fill="transparent"
              stroke={seg.color}
              strokeWidth={hoveredIndex === i ? strokeWidth + 4 : strokeWidth}
              strokeDasharray={seg.strokeDasharray}
              strokeDashoffset={seg.strokeDashoffset}
              strokeLinecap="round"
              className="cursor-pointer transition-all duration-300"
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
            />
          ))}
        </svg>

        {/* Center Donut Label */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          {activeSegment ? (
            <>
              <span className="text-[10px] font-bold text-[#64748B] truncate max-w-[110px]">{activeSegment.name}</span>
              <span className="text-sm font-extrabold text-[#0F172A] tabular-nums">
                {activeSegment.percentage}%
              </span>
              <span className="text-[10px] font-bold text-[#059669]">
                {fmtNumber(activeSegment.value)} ر.س
              </span>
            </>
          ) : (
            <>
              <span className="text-[10px] font-bold text-[#64748B]">إجمالي الإيرادات</span>
              <span className="text-sm font-extrabold text-[#0F172A] tabular-nums">
                {fmtNumber(total)} <span className="text-[10px] text-[#64748B]">ر.س</span>
              </span>
            </>
          )}
        </div>
      </div>

      {/* Interactive Department Breakdown List */}
      <div className="space-y-2 max-h-[170px] overflow-y-auto pr-1 scrollbar-thin">
        {segments.map((d, i) => {
          const isHovered = hoveredIndex === i;
          return (
            <div
              key={i}
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
              className={`flex items-center justify-between rounded-xl border px-3 py-2 text-xs transition-all cursor-pointer ${
                isHovered
                  ? "border-[#FFD369] bg-white shadow-xs scale-[1.01]"
                  : "border-[#E2E8F0] bg-[#F8FAF9] hover:bg-white"
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: d.color }} />
                <span className="truncate font-bold text-[#0F172A]">{d.name}</span>
              </div>
              <div className="flex items-center gap-2.5 shrink-0">
                <span className="font-extrabold text-[#0F172A] tabular-nums">
                  {fmtNumber(d.value)} <span className="text-[10px] text-[#64748B]">ر.س</span>
                </span>
                <span
                  className={`rounded-lg px-1.5 py-0.5 text-[10px] font-extrabold transition-colors ${
                    isHovered ? "bg-[#222831] text-[#FFD369]" : "bg-white border border-[#CBD5E1] text-[#222831]"
                  }`}
                >
                  {d.percentage}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function HotelKpiTrendChart({
  data,
}: {
  data: Array<{ month: string; adr: number; revpar: number; occupancy: number }>;
}) {
  const hasData = data && data.length > 0 && data.some((d) => d.adr > 0 || d.revpar > 0 || d.occupancy > 0);

  if (!hasData) {
    return (
      <div className="flex flex-col items-center justify-center py-10 px-4 text-center rounded-2xl border border-dashed border-[#CBD5E1] bg-[#F8FAF9]/60">
        <p className="text-xs font-bold text-[#0F172A]">لا توجد بيانات تشغيل غرف مسجلة للفترة</p>
        <p className="text-[11px] text-[#64748B] mt-0.5">يتم احتساب مؤشرات ADR و RevPAR تلقائياً عند فتح الفوليو وتسجيل ليالي الإقامة.</p>
      </div>
    );
  }

  const currentData = data;
  const maxVal = Math.max(...currentData.map((d) => Math.max(d.adr, d.revpar))) * 1.2 || 500;

  const svgWidth = 500;
  const svgHeight = 180;
  const paddingLeft = 35;
  const paddingRight = 65;
  const paddingTop = 20;
  const paddingBottom = 30;
  const plotWidth = svgWidth - paddingLeft - paddingRight;
  const plotHeight = svgHeight - paddingTop - paddingBottom;

  const stepX = plotWidth / Math.max(1, currentData.length - 1);
  const getY = (val: number) => paddingTop + plotHeight - (val / maxVal) * plotHeight;

  const ptsAdr = currentData.map((d, i) => ({ x: paddingLeft + i * stepX, y: getY(d.adr) }));
  const ptsRev = currentData.map((d, i) => ({ x: paddingLeft + i * stepX, y: getY(d.revpar) }));

  const createPathD = (pts: { x: number; y: number }[]) => {
    if (pts.length === 0) return "";
    const first = pts[0] ?? { x: 0, y: 0 };
    let d = `M ${first.x} ${first.y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i] ?? { x: 0, y: 0 };
      const p2 = pts[i + 1] ?? { x: 0, y: 0 };
      const mx = (p1.x + p2.x) / 2;
      d += ` C ${mx} ${p1.y}, ${mx} ${p2.y}, ${p2.x} ${p2.y}`;
    }
    return d;
  };

  const pathAdr = createPathD(ptsAdr);
  const pathRev = createPathD(ptsRev);

  const lastAdr = ptsAdr[ptsAdr.length - 1] ?? { x: 0, y: 0 };
  const firstAdr = ptsAdr[0] ?? { x: 0, y: 0 };
  const areaAdr = `${pathAdr} L ${lastAdr.x} ${paddingTop + plotHeight} L ${firstAdr.x} ${paddingTop + plotHeight} Z`;

  const lastRev = ptsRev[ptsRev.length - 1] ?? { x: 0, y: 0 };
  const firstRev = ptsRev[0] ?? { x: 0, y: 0 };
  const areaRev = `${pathRev} L ${lastRev.x} ${paddingTop + plotHeight} L ${firstRev.x} ${paddingTop + plotHeight} Z`;

  return (
    <div className="space-y-3">
      <div className="w-full overflow-hidden rounded-xl bg-[#F8FAF9]/60 border border-[#E2E8F0] p-1.5">
        <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-[180px] overflow-visible select-none">
          <defs>
            <linearGradient id="adrGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FFD369" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#FFD369" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#222831" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#222831" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          {[0, maxVal * 0.5, maxVal].map((tVal, idx) => {
            const y = getY(tVal);
            return (
              <g key={idx}>
                <line x1={paddingLeft} y1={y} x2={svgWidth - paddingRight} y2={y} stroke="#E2E8F0" strokeDasharray="3 3" />
                <text x={svgWidth - paddingRight + 8} y={y + 3} fill="#64748B" fontSize="9.5" fontWeight="600">
                  {Math.round(tVal)} ر.س
                </text>
              </g>
            );
          })}

          {/* Areas & Paths */}
          <path d={areaAdr} fill="url(#adrGrad)" />
          <path d={pathAdr} fill="none" stroke="#FFD369" strokeWidth="2.5" />
          <path d={areaRev} fill="url(#revGrad)" />
          <path d={pathRev} fill="none" stroke="#222831" strokeWidth="2" />

          {/* Dots */}
          {ptsAdr.map((pt, i) => (
            <circle key={i} cx={pt.x} cy={pt.y} r={3.5} fill="#FFD369" stroke="#222831" strokeWidth="1.5" />
          ))}
          {ptsRev.map((pt, i) => (
            <circle key={i} cx={pt.x} cy={pt.y} r={3.5} fill="#222831" stroke="#FFFFFF" strokeWidth="1.5" />
          ))}

          {/* X-Axis labels */}
          {currentData.map((d, i) => {
            const pt = ptsAdr[i] ?? { x: 0, y: 0 };
            return (
              <text key={i} x={pt.x} y={svgHeight - 8} textAnchor="middle" fill="#64748B" fontSize="10" fontWeight="600">
                {formatMonthName(d.month)}
              </text>
            );
          })}
        </svg>
      </div>

      <div className="flex items-center justify-center gap-6 text-xs border-t border-[#E2E8F0] pt-2">
        <div className="flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-[#FFD369] shadow-xs" />
          <span className="font-bold text-[#0F172A]">متوسط السعر اليومي (ADR)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-[#222831] shadow-xs" />
          <span className="font-bold text-[#0F172A]">الإيراد لكل غرفة متاحة (RevPAR)</span>
        </div>
      </div>
    </div>
  );
}
