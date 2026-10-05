import { tr } from "@/i18n/tr";
import { BedDouble, ChartNoAxesColumn, ReceiptText, UsersRound } from "lucide-react";
import { BRAND_N, BrandMark } from "@/components/brand-mark";
import { LanguageSwitch } from "@/components/language-switch";

/** رقم شبه عشوائي ثابت لكل نافذة، فتبقى الواجهة نفسها في كل تحميل ولا تختلف بين الخادم والمتصفح */
function noise(a: number, b: number, c: number) {
  const x = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
  return x - Math.floor(x);
}

const TOWERS = [
  { x: 36, w: 150, h: 380 },
  { x: 204, w: 196, h: 540 },
  { x: 418, w: 146, h: 320 },
];

/** فندق في الليل: أبراج بنوافذ مضاءة تتبدّل ببطء، وعلامة نزيل على سطح البرج الأوسط */
function HotelNight() {
  const ground = 640;
  const windows: { x: number; y: number; kind: "off" | "warm" | "blue" | "glow"; delay: number }[] = [];
  TOWERS.forEach((t, ti) => {
    const cols = Math.floor((t.w - 24) / 28);
    const rows = Math.floor((t.h - 40) / 38);
    const pad = (t.w - (cols * 28 - 12)) / 2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = noise(ti, r, c);
        const kind = v < 0.02 ? "blue" : v < 0.36 ? "warm" : v < 0.47 ? "glow" : "off";
        windows.push({ x: t.x + pad + c * 28, y: ground - t.h + 28 + r * 38, kind, delay: Math.round(noise(c, ti, r) * 9000) });
      }
    }
  });
  const mid = TOWERS[1]!;
  return (
    <svg viewBox="0 0 600 660" preserveAspectRatio="xMidYMax meet" aria-hidden className="h-full w-full">
      <defs>
        <radialGradient id="auth-ground" cx="50%" cy="100%" r="60%">
          <stop offset="0%" stopColor="#2483e1" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#2483e1" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="auth-tower" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3a3734" />
          <stop offset="100%" stopColor="#262422" />
        </linearGradient>
      </defs>
      <ellipse cx="300" cy={ground} rx="340" ry="120" fill="url(#auth-ground)" />
      {TOWERS.map((t, i) => (
        <rect key={i} x={t.x} y={ground - t.h} width={t.w} height={t.h} rx="6" fill="url(#auth-tower)" stroke="#ffffff" strokeOpacity="0.05" />
      ))}
      {windows.map((w, i) => (
        <rect key={i} x={w.x} y={w.y} width="16" height="22" rx="2.5"
          className={w.kind === "glow" ? "auth-window" : undefined}
          style={w.kind === "glow" ? { animationDelay: `${w.delay}ms` } : undefined}
          fill={w.kind === "off" ? "#ffffff" : w.kind === "blue" ? "#4a9bea" : "#f4d9a3"}
          fillOpacity={w.kind === "off" ? 0.05 : w.kind === "blue" ? 0.95 : w.kind === "warm" ? 0.88 : 0.85} />
      ))}
      {/* علامة نزيل على السطح */}
      <g transform={`translate(${mid.x + mid.w / 2 - 26} ${ground - mid.h - 64}) scale(0.52)`}>
        <rect x="46" y="100" width="8" height="24" fill="#3a3734" />
        <rect width="100" height="100" rx="24" fill="#f7f4ec" />
        <path fill="#312F2E" d={BRAND_N} />
        <circle cx="69.94" cy="69.75" r="5.25" fill="#2483E1" />
      </g>
      <rect x="0" y={ground} width="600" height="20" fill="#1b1a19" />
    </svg>
  );
}

const FEATURES = [
  { icon: BedDouble, get text() { return tr("الحجوزات والغرف والنزلاء"); } },
  { icon: ReceiptText, get text() { return tr("الفوترة والصندوق والمحاسبة"); } },
  { icon: UsersRound, get text() { return tr("الموظفون وصلاحياتهم"); } },
  { icon: ChartNoAxesColumn, get text() { return tr("تقارير لحظية لكل شيء"); } },
];

/** إطار صفحات ما قبل الدخول: لوحة الفندق في الليل، وبجانبها المحتوى (ابدأ، الدخول، رابط الموظف) */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col bg-[#fbf9f3] lg:flex-row">
      <section className="relative isolate flex flex-col overflow-hidden bg-[radial-gradient(120%_80%_at_70%_0%,#2c3846_0%,#1f1d1b_55%,#1b1a19_100%)] text-white lg:min-h-screen lg:w-[54%]">
        <div className="relative z-10 space-y-6 p-7 pb-2 sm:p-10 sm:pb-2 lg:p-14">
          <div className="flex items-center gap-3">
            <BrandMark className="size-10 ring-1 ring-white/15 rounded-[10px]" />
            <span className="text-[22px] font-semibold tracking-tight">{tr("نزيل")}</span>
          </div>
          <div className="max-w-md space-y-3">
            <h2 className="text-[30px] font-bold leading-[1.25] sm:text-[38px]">{tr("فندقك كله في مكان واحد")}</h2>
            <p className="text-[16.5px] leading-relaxed text-white/65">{tr("من حجز الغرفة حتى التقرير المالي، كل عملية تُسجَّل مرة واحدة وتظهر في مكانها الصحيح.")}</p>
          </div>
          <ul className="hidden gap-3 sm:grid sm:grid-cols-2 lg:max-w-md lg:grid-cols-1">
            {FEATURES.map((f) => (
              <li key={f.text} className="flex items-center gap-3 text-[15.5px] text-white/85">
                <span className="grid size-9 place-items-center rounded-lg bg-white/[0.07] ring-1 ring-white/10"><f.icon className="size-[18px] text-[#9cc6f2]" /></span>
                {f.text}
              </li>
            ))}
          </ul>
        </div>
        <div className="pointer-events-none relative h-[150px] sm:h-[200px] lg:absolute lg:inset-x-8 lg:bottom-0 lg:h-[50%]">
          <HotelNight />
        </div>
      </section>

      <section className="relative flex flex-1 items-center justify-center px-4 pt-20 pb-10 sm:px-8 lg:py-10">
        <LanguageSwitch className="absolute end-4 top-4" />
        <div className="animate-rise w-full max-w-[420px]">{children}</div>
      </section>
    </main>
  );
}
