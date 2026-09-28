"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { Bot, Plus, SendHorizontal, Square, X } from "lucide-react";
import { DocText } from "@/components/ui/code-text";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "assistant"; content: string; error?: boolean };

const TOOL_LABEL: Record<string, string> = {
  system_guide: "يقرأ دليل النظام",
  hotel_snapshot: "يقرأ حالة الفندق الآن",
  run_report: "يشغّل التقرير",
  search_records: "يبحث في السجلات",
  record_details: "يفتح السجل",
  audit_trail: "يراجع سجل التدقيق",
};

const SUGGESTIONS = ["اشرح لي هذه الصفحة", "ما وضع الفندق اليوم؟", "لخّص أداء هذا الشهر", "هل الحسابات متوازنة ومطابقة؟"];

/** ما يظهر في الصفحة الحالية باختصار، ليفهم المساعد سياق السؤال */
function pageContext(path: string) {
  const main = document.querySelector("main");
  const title = main?.querySelector("h1")?.textContent?.trim() ?? document.title;
  const text = (main?.innerText ?? "").replace(/\s+\n/g, "\n").replace(/\n{2,}/g, "\n").replace(/[ \t]{2,}/g, " ").slice(0, 3500);
  return { path, title, text };
}

/** زر المساعد في الشريط العلوي ولوحته الجانبية: محادثة تبقى أثناء التنقل بين الصفحات */
export function Assistant() {
  const [open, setOpen] = React.useState(false);
  const [msgs, setMsgs] = React.useState<Msg[]>([]);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const abort = React.useRef<AbortController | null>(null);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null);
  const pathname = usePathname();

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") { e.preventDefault(); setOpen((v) => !v); }
      else if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  React.useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  React.useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [msgs, status]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    const history: Msg[] = [...msgs.filter((x) => !x.error), { role: "user", content: q }];
    setMsgs([...history, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    setStatus("يفكر");
    const ctrl = new AbortController();
    abort.current = ctrl;
    const append = (text: string, error = false) => setMsgs((all) => {
      const next = [...all];
      const last = next[next.length - 1]!;
      next[next.length - 1] = { ...last, content: last.content + text, error: error || last.error };
      return next;
    });
    let afterTool = false;
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })), page: pageContext(pathname) }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error(res.status === 503 ? "المساعد غير مفعّل على الخادم." : "تعذّر الوصول إلى المساعد، حاول مرة أخرى.");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as { type: string; text?: string; name?: string; message?: string };
          if (ev.type === "text" && ev.text) {
            setStatus(null);
            // النص بعد قراءة الأدوات يبدأ فقرة جديدة
            append(afterTool ? `\n\n${ev.text}` : ev.text);
            afterTool = false;
          } else if (ev.type === "tool") {
            setStatus(TOOL_LABEL[ev.name ?? ""] ?? "يقرأ البيانات");
            afterTool = true;
          } else if (ev.type === "error") {
            append(ev.message ?? "حدث خطأ", true);
          }
        }
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) append(e instanceof Error ? e.message : "حدث خطأ", true);
    } finally {
      setBusy(false);
      setStatus(null);
      abort.current = null;
      setMsgs((all) => all.filter((x, i) => !(i === all.length - 1 && x.role === "assistant" && !x.content)));
    }
  };

  return (
    <>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} title="المساعد الذكي Ctrl J"
        className={cn("flex h-10 shrink-0 items-center gap-2 rounded-lg border border-line bg-white px-3 text-[16px] font-medium text-slate-700 transition-colors duration-200 hover:text-ink",
          open && "border-ink text-ink")}>
        <Bot className="size-[18px] stroke-[1.75]" />
        <span className="hidden lg:inline">المساعد</span>
      </button>

      <AnimatePresence>
        {open && (
          <m.aside key="assistant" role="dialog" aria-label="المساعد الذكي"
            initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="assistant-panel fixed inset-y-3 end-3 z-50 flex w-[min(460px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border border-line bg-white">
            <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line px-5">
              <span className="flex size-9 items-center justify-center rounded-[10px] bg-subtle text-ink"><Bot className="size-[18px] stroke-[1.75]" /></span>
              <p className="flex-1 text-[17px] font-semibold text-ink">المساعد</p>
              {msgs.length > 0 && (
                <button type="button" disabled={busy} onClick={() => setMsgs([])} title="محادثة جديدة" aria-label="محادثة جديدة"
                  className="flex size-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-subtle hover:text-ink disabled:opacity-40">
                  <Plus className="size-[18px]" />
                </button>
              )}
              <button type="button" onClick={() => setOpen(false)} title="إغلاق" aria-label="إغلاق"
                className="flex size-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-subtle hover:text-ink">
                <X className="size-[18px]" />
              </button>
            </header>

            <div ref={listRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
              {msgs.length === 0 && (
                <div className="space-y-5 pt-6">
                  <div className="space-y-2">
                    <p className="text-[22px] font-bold text-ink">كيف أساعدك؟</p>
                    <p className="text-[16px] leading-relaxed text-slate-600">أفهم كل أقسام النظام وأقرأ بياناتك الحية بصلاحياتك، فاسألني عن أي شاشة أو رقم أو مشكلة.</p>
                  </div>
                  <div className="flex flex-col items-start gap-2">
                    {SUGGESTIONS.map((s) => (
                      <button key={s} type="button" onClick={() => void ask(s)}
                        className="rounded-lg bg-subtle px-3 py-2 text-start text-[15.5px] text-slate-700 transition-colors hover:bg-line hover:text-ink">{s}</button>
                    ))}
                  </div>
                </div>
              )}
              {msgs.map((msg, i) => msg.role === "user" ? (
                <div key={i} className="flex justify-start">
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-subtle px-4 py-2.5 text-[16px] text-ink">{msg.content}</p>
                </div>
              ) : (
                <Answer key={i} text={msg.content} error={msg.error} />
              ))}
              {status && (
                <p className="flex items-center gap-2 text-[15.5px] text-slate-500">
                  <span className="assistant-dots" aria-hidden><i /><i /><i /></span>{status}
                </p>
              )}
            </div>

            <form className="shrink-0 border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); void ask(input); }}>
              <div className="flex items-end gap-2 rounded-xl border border-line bg-white p-2 focus-within:border-ink">
                <textarea ref={inputRef} value={input} rows={1} placeholder="اسأل عن أي شيء في النظام"
                  onChange={(e) => { setInput(e.target.value); e.target.style.height = "auto"; e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`; }}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(input); } }}
                  className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-[16px] text-ink outline-none placeholder:text-slate-400" />
                {busy ? (
                  <button type="button" onClick={() => abort.current?.abort()} title="إيقاف" aria-label="إيقاف"
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-ink text-white"><Square className="size-3.5 fill-current" /></button>
                ) : (
                  <button type="submit" disabled={!input.trim()} title="إرسال" aria-label="إرسال"
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-ink text-white transition-opacity disabled:opacity-30"><SendHorizontal className="size-4 -scale-x-100" /></button>
                )}
              </div>
            </form>
          </m.aside>
        )}
      </AnimatePresence>
    </>
  );
}

/** رد المساعد: فقرات وقوائم مرقمة، وأرقام المستندات في شارات منفصلة عن النص */
function Answer({ text, error }: { text: string; error?: boolean }) {
  if (!text) return null;
  const blocks = text.replace(/\*\*|__|^#+\s*/gm, "").split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return (
    <div className={cn("space-y-3 text-[16px] leading-[1.85]", error ? "text-urgent" : "text-ink")}>
      {blocks.map((b, i) => {
        const lines = b.split("\n").map((l) => l.trim()).filter(Boolean);
        const items = lines.map((l) => /^(\d+)[.)]\s+(.*)$/.exec(l));
        if (items.every(Boolean)) {
          return (
            <ol key={i} className="space-y-1.5">
              {items.map((it, k) => (
                <li key={k} className="flex gap-2.5">
                  <span className="num mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-subtle text-slate-600">{it![1]}</span>
                  <DocText text={it![2]} />
                </li>
              ))}
            </ol>
          );
        }
        return <p key={i}>{lines.map((l, k) => <React.Fragment key={k}>{k > 0 && <br />}<DocText text={l.replace(/^[•*-]\s+/, "")} /></React.Fragment>)}</p>;
      })}
    </div>
  );
}
