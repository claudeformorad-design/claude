"use client";
import { tr } from "@/i18n/tr";

import * as React from "react";
import { getConversationAction } from "@/app/assistant/actions";
import { callAction } from "@/lib/action-error";

export type ChatMsg = { id: string; role: "user" | "assistant"; content: string; error?: boolean };
export type PageInfo = { path: string; title?: string; text?: string };

export const TOOL_LABEL: Record<string, string> = {
  get system_guide() { return tr("يقرأ دليل النظام"); },
  get hotel_snapshot() { return tr("يقرأ حالة الفندق الآن"); },
  get run_report() { return tr("يشغّل التقرير"); },
  get search_records() { return tr("يبحث في السجلات"); },
  get record_details() { return tr("يفتح السجل"); },
  get audit_trail() { return tr("يراجع سجل التدقيق"); },
};

let seq = 0;
const localId = () => `local-${++seq}`;

/**
 * محادثة واحدة مع المساعد: الإرسال بالبث، الإيقاف، إعادة توليد آخر رد، وتحميل محادثة محفوظة.
 * onSaved يُستدعى عند إنشاء المحادثة أو انتهاء رد (لتحديث قائمة المحادثات).
 */
export function useChat(onSaved?: (c: { id: string; title: string }) => void) {
  const [conversationId, setConversationId] = React.useState<string | null>(null);
  const [title, setTitle] = React.useState<string>("");
  const [messages, setMessages] = React.useState<ChatMsg[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const abort = React.useRef<AbortController | null>(null);
  // قفل فوري ضد الضغط المزدوج: الحالة busy لا تتحدث إلا بعد إعادة الرسم
  const busyRef = React.useRef(false);
  const idRef = React.useRef<string | null>(null);
  const savedRef = React.useRef(onSaved);
  React.useEffect(() => { savedRef.current = onSaved; });

  const reset = React.useCallback(() => {
    abort.current?.abort();
    idRef.current = null;
    setConversationId(null);
    setTitle("");
    setMessages([]);
    setStatus(null);
  }, []);

  const load = React.useCallback(async (id: string) => {
    abort.current?.abort();
    setLoading(true);
    const r = await callAction(getConversationAction(id));
    setLoading(false);
    if (!r.ok || !r.data) return false;
    idRef.current = id;
    setConversationId(id);
    setTitle(r.data.conversation.title);
    setMessages(r.data.messages.map((m) => ({ id: m.id, role: m.role, content: m.content, error: m.is_error })));
    return true;
  }, []);

  const run = React.useCallback(async (payload: { question?: string; retry?: boolean }, page?: PageInfo) => {
    busyRef.current = true;
    setBusy(true);
    setStatus(tr("يفكر"));
    const ctrl = new AbortController();
    abort.current = ctrl;
    // الخطأ بعد جزء من الرد يظهر في فقاعة مستقلة، فيبقى ما وصل مقروءًا كما هو
    const append = (text: string, error = false) => setMessages((all) => {
      const last = all[all.length - 1]!;
      if (error && last.content.trim() && !last.error) return [...all, { id: localId(), role: "assistant", content: text.trim(), error: true }];
      return [...all.slice(0, -1), { ...last, content: last.content + text, error: error || last.error }];
    });
    let afterTool = false;
    let finished = false;
    let received = false;
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: idRef.current ?? undefined, ...payload, page }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const code = res.status === 503 ? "not_configured" : ((await res.json().catch(() => null)) as { error?: string } | null)?.error;
        throw new Error(
          code === "not_configured" ? tr("المساعد غير مفعّل بعد. يفعّله صاحب النظام من إعدادات الفندق.")
          : code === "unauthorized" || res.status === 401 ? tr("انتهت جلستك، سجّل الدخول من جديد ثم أعد السؤال.")
          : code === "not_found" ? tr("هذه المحادثة لم تعد موجودة، ابدأ محادثة جديدة.")
          : code === "validation" ? tr("السؤال طويل جدًا أو فارغ، اختصره وأعد المحاولة.")
          : tr("تعذّر الوصول إلى المساعد، حاول مرة أخرى."),
        );
      }
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
          let parsed: unknown;
          try { parsed = JSON.parse(line); } catch { continue; }
          const ev = parsed as { type: string; text?: string; name?: string; message?: string; id?: string; title?: string };
          if (ev.type === "conversation" && ev.id) {
            idRef.current = ev.id;
            setConversationId(ev.id);
            setTitle(ev.title ?? "");
            savedRef.current?.({ id: ev.id, title: ev.title ?? "" });
          } else if (ev.type === "text" && ev.text) {
            received = true;
            setStatus(null);
            const text = ev.text;
            const newBlock = afterTool;
            afterTool = false;
            setMessages((all) => {
              const last = all[all.length - 1]!;
              const sep = newBlock && last.content && !last.content.endsWith("\n") ? "\n\n" : "";
              return [...all.slice(0, -1), { ...last, content: last.content + sep + text }];
            });
          } else if (ev.type === "tool") {
            setStatus(TOOL_LABEL[ev.name ?? ""] ?? tr("يقرأ البيانات"));
            afterTool = true;
          } else if (ev.type === "error") {
            finished = true;
            append(ev.message ?? tr("حدث خطأ"), true);
          } else if (ev.type === "done") {
            finished = true;
          }
        }
      }
      // انقطع البث قبل نهايته (مهلة الخادم أو الشبكة): يُقال ذلك بوضوح بدل رد ناقص صامت
      if (!finished && !ctrl.signal.aborted) {
        append(received ? tr("انقطع الرد قبل اكتماله. اضغط إعادة المحاولة.") : tr("انقطع الاتصال قبل وصول الرد. اضغط إعادة المحاولة."), true);
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        // فشل الشبكة يصل من المتصفح بنص إنجليزي تقني (Failed to fetch)، فيُستبدل برسالة مفهومة
        append(e instanceof TypeError ? tr("تعذّر الاتصال بالخادم، تحقق من الإنترنت وحاول مرة أخرى.") : e instanceof Error ? e.message : tr("حدث خطأ"), true);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
      setStatus(null);
      abort.current = null;
      setMessages((all) => all.filter((x, i) => !(i === all.length - 1 && x.role === "assistant" && !x.content)));
      if (idRef.current) savedRef.current?.({ id: idRef.current, title: "" });
    }
  }, []);

  const ask = React.useCallback(async (question: string, page?: PageInfo) => {
    const q = question.trim();
    if (!q || busyRef.current) return;
    setMessages((all) => [...all, { id: localId(), role: "user", content: q }, { id: localId(), role: "assistant", content: "" }]);
    await run({ question: q }, page);
  }, [run]);

  const retry = React.useCallback(async (page?: PageInfo) => {
    if (busyRef.current || !idRef.current) return;
    setMessages((all) => {
      // كل ما بعد آخر سؤال يُستبدل: الرد الجزئي ورسالة الخطأ معًا
      let end = all.length;
      while (end > 0 && all[end - 1]!.role === "assistant") end--;
      return [...all.slice(0, end), { id: localId(), role: "assistant", content: "" }];
    });
    await run({ retry: true }, page);
  }, [run]);

  const stop = React.useCallback(() => abort.current?.abort(), []);

  return { conversationId, title, messages, busy, status, loading, ask, retry, stop, reset, load };
}
