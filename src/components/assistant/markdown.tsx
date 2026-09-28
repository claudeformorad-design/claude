import * as React from "react";
import { CodeTag, DocText } from "@/components/ui/code-text";
import { cn } from "@/lib/utils";

/**
 * عرض إجابات المساعد بطباعة هادئة على نمط نوشن: عناوين وقوائم وجداول وخط عريض،
 * بلا أي رمز تنسيق ظاهر. أرقام المستندات في شارات، والتواريخ معزولة الاتجاه، والمبالغ في الجداول بمحاذاة الأرقام.
 */
type Block =
  | { kind: "h"; level: number; text: string }
  | { kind: "p"; lines: string[] }
  | { kind: "ul" | "ol"; items: { n?: string; text: string }[] }
  | { kind: "table"; rows: string[][] }
  | { kind: "hr" };

const NUMERIC = /^[‎‏\s]*[-+]?[\d,]+(\.\d+)?\s*%?[‎‏\s]*$/;

function parse(src: string): Block[] {
  const blocks: Block[] = [];
  const lines = src.replace(/\r/g, "").split("\n");
  const last = () => blocks[blocks.length - 1];
  for (const raw of lines) {
    const line = raw.trimEnd();
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

/** نص عادي مع الحفاظ على المسافة في طرفيه (التنظيف يحذفها فتلتصق الكلمة بالعريض المجاور) */
function Plain({ text }: { text: string }) {
  if (!text.trim()) return text ? <>{" "}</> : null;
  return <>{/^\s/.test(text) && " "}<DocText text={text} />{/\s$/.test(text) && " "}</>;
}

/** نص سطر واحد: **عريض** و`رمز`، والباقي نص عادي تُفصل فيه أرقام المستندات */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) => p.startsWith("**") && p.endsWith("**") && p.length > 4
        ? <strong key={i} className="font-semibold text-ink"><DocText text={p.slice(2, -2)} /></strong>
        : p.startsWith("`") && p.endsWith("`") && p.length > 2
          ? <CodeTag key={i}>{p.slice(1, -1)}</CodeTag>
          : <Plain key={i} text={p} />)}
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
                            {numeric[c] ? <span className="num">{(r[c] ?? "").replace(/\*\*/g, "")}</span> : <Inline text={r[c] ?? ""} />}
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
