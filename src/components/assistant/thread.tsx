"use client";
import { tr } from "@/i18n/tr";

import * as React from "react";
import { AlertCircle, Bookmark, Check, Copy, RotateCcw } from "lucide-react";
import { saveAnswerAction } from "@/app/assistant/actions";
import { toast } from "@/components/ui/toast";
import { callAction } from "@/lib/action-error";
import { cn } from "@/lib/utils";
import { AssistantMark } from "./mark";
import { Markdown } from "./markdown";
import type { ChatMsg } from "./use-chat";

/**
 * سلسلة المحادثة: سؤال المستخدم في فقاعة هادئة، ورد المساعد نصًا حرًا بطباعة مريحة،
 * وتحته أدوات النسخ والحفظ وإعادة التوليد. حالة القراءة تظهر بعلامة تتنفس واسم الأداة.
 */
export function Thread({ messages, busy, status, conversationId, onRetry, compact = false }: {
  messages: ChatMsg[];
  busy: boolean;
  status: string | null;
  conversationId: string | null;
  onRetry: () => void;
  compact?: boolean;
}) {
  const lastAssistant = messages.map((m) => m.role).lastIndexOf("assistant");
  return (
    <div className={cn("space-y-7", compact && "space-y-6")}>
      {messages.map((m, i) => m.role === "user" ? (
        <div key={m.id} className="flex justify-start">
          <p className="max-w-[85%] whitespace-pre-wrap rounded-[18px] bg-subtle px-4 py-2.5 text-[16px] leading-relaxed text-ink">{m.content}</p>
        </div>
      ) : (
        (m.content || !busy || i !== messages.length - 1) && (
          <Answer key={m.id} msg={m} question={messages[i - 1]?.role === "user" ? messages[i - 1]!.content : ""}
            conversationId={conversationId} streaming={busy && i === messages.length - 1}
            canRetry={!busy && i === lastAssistant && i === messages.length - 1} onRetry={onRetry} />
        )
      ))}
      {status && (
        <div className="flex items-center gap-3 text-[15.5px] text-slate-500">
          <AssistantMark thinking className="size-5 text-ink" />
          <span className="assistant-shimmer">{status}</span>
        </div>
      )}
    </div>
  );
}

function Answer({ msg, question, conversationId, streaming, canRetry, onRetry }: {
  msg: ChatMsg; question: string; conversationId: string | null; streaming: boolean; canRetry: boolean; onRetry: () => void;
}) {
  const [copied, setCopied] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  if (!msg.content) return null;

  const copy = async () => {
    await navigator.clipboard.writeText(msg.content).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const save = async () => {
    const r = await callAction(saveAnswerAction({ conversationId, question, content: msg.content }));
    if (r.ok) { setSaved(true); toast(tr("حُفظت الإجابة في المحفوظات")); }
    else toast(tr("تعذّر حفظ الإجابة"), "error");
  };

  if (msg.error) {
    return (
      <div className="flex items-start gap-3 rounded-xl bg-urgent-tint px-4 py-3 text-[15.5px] text-urgent">
        <AlertCircle className="mt-1 size-[18px] shrink-0" />
        <p className="flex-1 leading-relaxed">{msg.content}</p>
        {canRetry && <button type="button" onClick={onRetry} className="shrink-0 rounded-md px-2 py-0.5 font-medium hover:bg-white/60">{tr("إعادة المحاولة")}</button>}
      </div>
    );
  }

  const tool = "flex size-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-subtle hover:text-ink";
  return (
    <div className="group flex gap-3">
      <AssistantMark thinking={streaming} className="mt-[5px] size-5 text-ink" />
      <div className="min-w-0 flex-1">
        <Markdown text={msg.content} />
        {!streaming && (
          <div className={cn("mt-2 -ms-1.5 flex items-center gap-0.5 transition-opacity", canRetry ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100")}>
            <button type="button" onClick={copy} className={tool} title={tr("نسخ")} aria-label={tr("نسخ")}>
              {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
            </button>
            <button type="button" onClick={save} disabled={saved} className={tool} title={tr("حفظ في المحفوظات")} aria-label={tr("حفظ في المحفوظات")}>
              <Bookmark className={cn("size-4", saved && "fill-current text-ink")} />
            </button>
            {canRetry && (
              <button type="button" onClick={onRetry} className={tool} title={tr("إعادة توليد الرد")} aria-label={tr("إعادة توليد الرد")}>
                <RotateCcw className="size-4" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
