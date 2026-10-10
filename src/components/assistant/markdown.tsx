import * as React from "react";
import Link from "next/link";
import { CodeTag, DocText } from "@/components/ui/code-text";
import { cn } from "@/lib/utils";

/**
 * عرض إجابات المساعد بطباعة هادئة على نمط نوشن: عناوين وقوائم وجداول وخط عريض،
 * بلا أي رمز تنسيق ظاهر. أرقام المستندات في شارات، والتواريخ معزولة الاتجاه، والمبالغ في الجداول بمحاذاة الأرقام.
 * الروابط الداخلية [نص](/مسار) تفتح صفحة السجل داخل النظام، وكتلة ```chart ترسم أعمدة بيانية من أرقام الأدوات.
 */
type Block =
  | { kind: "h"; level: number; text: string }
  | { kind: "p"; lines: string[] }
  | { kind: "ul" | "ol"; items: { n?: string; text: string }[] }
  | { kind: "table"; rows: string[][] }
  | { kind: "hr" }
  | { kind: "chart"; chart: ChartSpec };

type ChartSpec = { title?: string; unit?: string; labels: string[]; series: { name: string; data: number[] }[] };

const NUMERIC = /^[‎‏\s]*[-+]?[\d,]+(\.\d+)?\s*%?[‎‏\s]*$/;

function parse(src: string): Block[] {
  const blocks: Block[] = [];
  const lines = src.replace(/\r/g, "").split("\n");
  const last = () => blocks[blocks.length - 1];
  let fence: { lang: string; body: string[] } | null = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    const f = /^\s*```\s*([a-z]*)\s*$/i.exec(line);
    if (fence) {
      if (!f) { fence.body.push(line); continue; }
      const chart = fence.lang === "chart" ? toChart(fence.body.join("\n")) : null;
      if (chart) blocks.push({ kind: "chart", chart });
      else if (fence.lang !== "chart" && fence.body.some((l) => l.trim())) blocks.push({ kind: "p", lines: fence.body.filter((l) => l.trim()) });
      fence = null;
      continue;
    }
    if (f) { fence = { lang: f[1]!.toLowerCase(), body: [] }; continue; }
    if (!line.trim()) { blocks.push({ kind: "p", lines: [] }); continue; }
    let m: RegExpExecArray | null;
    if ((m = /^\s*(#{1,4})\s+(.*)$/.exec(line))) { blocks.push({ kind: "h", level: m[1]!.length, text: m[2]! }); continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { blocks.push({ kind: "hr" }); continue; }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      if (/^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes("-")) continue;
      const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const b = last();
      if (b?.kind === "table") b.rows.push(cells); else blocks.push({ kind: "table", rows: [cells] });
      continue;
    }
    if ((m = /^\s*[-*•]\s+(.*)$/.exec(line))) {
      const b = last();
      if (b?.kind === "ul") b.items.push({ text: m[1]! }); else blocks.push({ kind: "ul", items: [{ text: m[1]! }] });
      continue;
    }
    if ((m = /^\s*(\d{1,3})[.)]\s+(.*)$/.exec(line))) {
      const b = last();
      if (b?.kind === "ol") b.items.push({ n: m[1], text: m[2]! }); else blocks.push({ kind: "ol", items: [{ n: m[1], text: m[2]! }] });
      continue;
    }
    const b = last();
    if (b?.kind === "p" && b.lines.length) b.lines.push(line.trim()); else blocks.push({ kind: "p", lines: [line.trim()] });
  }
  return blocks.filter((b) => b.kind !== "p" || b.lines.length);
}

/** يقبل الرسم فقط إن كانت بنيته سليمة: تسميات وسلسلة أو سلسلتان من أرقام بنفس الطول */
function toChart(json: string): ChartSpec | null {
  try {
    const v = JSON.parse(json) as Partial<ChartSpec>;
    const labels = Array.isArray(v.labels) ? v.labels.map(String).slice(0, 24) : [];
    const series = (Array.isArray(v.series) ? v.series : []).slice(0, 2).map((x) => ({
      name: String(x?.name ?? ""), data: (Array.isArray(x?.data) ? x.data : []).slice(0, labels.length).map(Number),
    })).filter((x) => x.data.length === labels.length && x.data.every(Number.isFinite));
    if (!labels.length || !series.length) return null;
    return { title: v.title ? String(v.title) : undefined, unit: v.unit ? String(v.unit) : undefined, labels, series };
  } catch { return null; }
}

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const SERIES_COLORS = ["bg-ink", "bg-amber-dot"];

/** أعمدة أفقية هادئة: لكل تسمية شريط لكل سلسلة، طوله نسبة من أكبر قيمة مطلقة، والسالب بلون التنبيه */
function Chart({ chart }: { chart: ChartSpec }) {
  const max = Math.max(1, ...chart.series.flatMap((s) => s.data.map(Math.abs)));
  return (
    <figure className="rounded-xl border border-line px-4 py-3.5">
      {(chart.title || chart.series.length > 1) && (
        <figcaption className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          {chart.title && <span className="font-semibold text-ink"><DocText text={chart.title} /></span>}
          <span className="flex flex-wrap items-center gap-x-4 text-slate-500">
            {chart.series.length > 1 && chart.series.map((s, k) => (
              <span key={k} className="flex items-center gap-1.5"><span aria-hidden className={cn("h-2.5 w-4 rounded-[3px]", SERIES_COLORS[k])} />{s.name}</span>
            ))}
            {chart.unit && <span>{chart.unit}</span>}
          </span>
        </figcaption>
      )}
      <div className="space-y-2.5">
        {chart.labels.map((label, i) => (
          <div key={i} className="grid grid-cols-[minmax(4.5rem,8rem)_1fr] items-center gap-3">
            <span className="truncate text-slate-600"><DocText text={label} /></span>
            <div className="space-y-1">
              {chart.series.map((s, k) => {
                const v = s.data[i]!;
                return (
                  <div key={k} className="flex items-center gap-2">
                    <div className="h-2.5 min-w-0 flex-1 rounded-[3px] bg-subtle">
                      <div className={cn("h-full rounded-[3px]", v < 0 ? "bg-urgent-dot" : SERIES_COLORS[k])} style={{ width: `${Math.max(1.5, (Math.abs(v) / max) * 100)}%` }} />
                    </div>
                    <span className="num w-24 shrink-0 text-end text-slate-600">{fmt(v)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </figure>
  );
}

/** نص عادي مع الحفاظ على المسافة في طرفيه (التنظيف يحذفها فتلتصق الكلمة بالعريض المجاور) */
function Plain({ text }: { text: string }) {
  if (!text.trim()) return text ? <>{" "}</> : null;
  return <>{/^\s/.test(text) && " "}<DocText text={text} />{/\s$/.test(text) && " "}</>;
}

const LINK = /^\[([^\]]+)\]\(([^)\s]+)\)$/;
/** المسار الداخلي فقط: يبدأ بشرطة مائلة واحدة، فلا تُفتح روابط خارجية من إجابة المساعد */
const internal = (href: string) => /^\/(?!\/)[\w\-/?=&.%]*$/.test(href);

/** نص سطر واحد: **عريض** و`رمز` و[رابط](/مسار)، والباقي نص عادي تُفصل فيه أرقام المستندات */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) => {
        const link = LINK.exec(p);
        if (link) {
          return internal(link[2]!)
            ? <Link key={i} href={link[2]!} className="font-medium text-action hover:text-action-hover"><DocText text={link[1]!} /></Link>
            : <Plain key={i} text={link[1]!} />;
        }
        return p.startsWith("**") && p.endsWith("**") && p.length > 4
        ? <strong key={i} className="font-semibold text-ink"><DocText text={p.slice(2, -2)} /></strong>
        : p.startsWith("`") && p.endsWith("`") && p.length > 2
          ? <CodeTag key={i}>{p.slice(1, -1)}</CodeTag>
          : <Plain key={i} text={p} />;
      })}
    </>
  );
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = React.useMemo(() => parse(text), [text]);
  return (
    <div className={cn("assistant-prose space-y-3.5 text-[16px] leading-[1.9] text-ink", className)}>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "h":
            return b.level <= 2
              ? <h3 key={i} className="pt-2 text-[18px] font-semibold leading-snug text-ink">{<Inline text={b.text} />}</h3>
              : <h4 key={i} className="pt-1 text-[16.5px] font-semibold leading-snug text-ink">{<Inline text={b.text} />}</h4>;
          case "hr":
            return <hr key={i} className="border-line" />;
          case "chart":
            return <Chart key={i} chart={b.chart} />;
          case "p":
            return <p key={i}>{b.lines.map((l, k) => <React.Fragment key={k}>{k > 0 && <br />}<Inline text={l} /></React.Fragment>)}</p>;
          case "ul":
            return (
              <ul key={i} className="space-y-1.5">
                {b.items.map((it, k) => (
                  <li key={k} className="flex gap-3">
                    <span aria-hidden className="mt-[0.8em] size-[5px] shrink-0 rounded-full bg-slate-400" />
                    <span className="min-w-0"><Inline text={it.text} /></span>
                  </li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i} className="space-y-1.5">
                {b.items.map((it, k) => (
                  <li key={k} className="flex gap-3">
                    <span className="num min-w-5 shrink-0 text-slate-500">{it.n}.</span>
                    <span className="min-w-0"><Inline text={it.text} /></span>
                  </li>
                ))}
              </ol>
            );
          case "table": {
            const [head, ...body] = b.rows;
            const width = Math.max(...b.rows.map((r) => r.length));
            const numeric = Array.from({ length: width }, (_, c) => body.length > 0 && body.every((r) => !r[c] || NUMERIC.test(r[c]!.replace(/\*\*/g, ""))));
            return (
              <div key={i} className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full text-[15.5px] leading-normal">
                  {head && (
                    <thead>
                      <tr className="bg-panel text-slate-600">
                        {Array.from({ length: width }, (_, c) => (
                          <th key={c} className={cn("px-3.5 py-2.5 font-medium whitespace-nowrap", numeric[c] ? "text-end" : "text-start")}><Inline text={head[c] ?? ""} /></th>
                        ))}
                      </tr>
                    </thead>
                  )}
                  <tbody className="divide-y divide-line">
                    {body.map((r, ri) => (
                      <tr key={ri}>
                        {Array.from({ length: width }, (_, c) => (
                          <td key={c} className={cn("px-3.5 py-2.5 align-top", numeric[c] ? "text-end whitespace-nowrap" : "text-start")}>
                            {numeric[c] && !LINK.test(r[c] ?? "") ? <span className="num">{(r[c] ?? "").replace(/\*\*/g, "")}</span> : <Inline text={r[c] ?? ""} />}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }
        }
      })}
    </div>
  );
}
