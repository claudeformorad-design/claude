"use client";
import { tr } from "@/i18n/tr";

import * as React from "react";
import { ArrowUp, Square } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * صندوق الكتابة: نص يتمدد مع الكتابة، وزر الإرسال في الزاوية اليمنى السفلية.
 * Enter يرسل، وShift مع Enter سطر جديد. أثناء الرد يتحول الزر إلى إيقاف.
 */
export function Composer({
  onSend, onStop, busy, placeholder = tr("اسأل عن أي شيء في النظام"), autoFocus, hint, className, value, onValueChange,
}: {
  onSend: (text: string) => void;
  onStop: () => void;
  busy: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  hint?: React.ReactNode;
  className?: string;
  /** قيمة يضعها الأب مسبقًا (مثل قالب سؤال)، مع التحكم بها */
  value?: string;
  onValueChange?: (v: string) => void;
}) {
  const [inner, setInner] = React.useState("");
  const text = value ?? inner;
  const setText = onValueChange ?? setInner;
  const ref = React.useRef<HTMLTextAreaElement | null>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text]);
  React.useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);

  const send = () => {
    if (busy || !text.trim()) return;
    onSend(text.trim());
    setText("");
  };

  return (
    <div className={cn("assistant-composer rounded-[18px] border border-line bg-white transition-colors focus-within:border-[#d4d1c8]", className)}>
      <textarea ref={ref} value={text} rows={1} placeholder={placeholder} aria-label={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
        className="block max-h-[220px] min-h-[52px] w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[16px] leading-relaxed text-ink outline-none placeholder:text-slate-400" />
      <div className="flex items-center gap-3 px-2.5 pb-2.5">
        {busy ? (
          <button type="button" onClick={onStop} title={tr("إيقاف")} aria-label={tr("إيقاف")}
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ink text-white transition-opacity hover:opacity-85">
            <Square className="size-3.5 fill-current" />
          </button>
        ) : (
          <button type="button" onClick={send} disabled={!text.trim()} title={tr("إرسال")} aria-label={tr("إرسال")}
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ink text-white transition-all hover:opacity-85 disabled:bg-subtle disabled:text-slate-400">
            <ArrowUp className="size-[18px] stroke-[2.2]" />
          </button>
        )}
        {hint && <span className="min-w-0 truncate text-[14px] text-slate-400">{hint}</span>}
      </div>
    </div>
  );
}
