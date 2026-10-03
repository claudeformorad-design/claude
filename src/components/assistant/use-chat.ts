"use client";

import * as React from "react";
import { getConversationAction } from "@/app/assistant/actions";
import { callAction } from "@/lib/action-error";

export type ChatMsg = { id: string; role: "user" | "assistant"; content: string; error?: boolean };
export type PageInfo = { path: string; title?: string; text?: string };

export const TOOL_LABEL: Record<string, string> = {
  system_guide: "يقرأ دليل النظام",
  hotel_snapshot: "يقرأ حالة الفندق الآن",
  run_report: "يشغّل التقرير",
  search_records: "يبحث في السجلات",
  record_details: "يفتح السجل",
  audit_trail: "يراجع سجل التدقيق",
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
    setBusy(true);
    setStatus("يفكر");
    const ctrl = new AbortController();
    abort.current = ctrl;
    const append = (text: string, error = false) => setMessages((all) => {
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
        body: JSON.stringify({ conversationId: idRef.current ?? undefined, ...payload, page }),
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
          const ev = JSON.parse(line) as { type: string; text?: string; name?: string; message?: string; id?: string; title?: string };
          if (ev.type === "conversation" && ev.id) {
            idRef.current = ev.id;
            setConversationId(ev.id);
            setTitle(ev.title ?? "");
            savedRef.current?.({ id: ev.id, title: ev.title ?? "" });
          } else if (ev.type === "text" && ev.text) {
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
      setMessages((all) => all.filter((x, i) => !(i === all.length - 1 && x.role === "assistant" && !x.content)));
      if (idRef.current) savedRef.current?.({ id: idRef.current, title: "" });
    }
  }, []);

  const ask = React.useCallback(async (question: string, page?: PageInfo) => {
    const q = question.trim();
    if (!q || busy) return;
    setMessages((all) => [...all, { id: localId(), role: "user", content: q }, { id: localId(), role: "assistant", content: "" }]);
    await run({ question: q }, page);
  }, [busy, run]);

  const retry = React.useCallback(async (page?: PageInfo) => {
    if (busy || !idRef.current) return;
    setMessages((all) => {
      const next = all[all.length - 1]?.role === "assistant" ? all.slice(0, -1) : all;
      return [...next, { id: localId(), role: "assistant", content: "" }];
    });
    await run({ retry: true }, page);
  }, [busy, run]);

  const stop = React.useCallback(() => abort.current?.abort(), []);

  return { conversationId, title, messages, busy, status, loading, ask, retry, stop, reset, load };
}
