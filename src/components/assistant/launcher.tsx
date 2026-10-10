"use client";
import { tr } from "@/i18n/tr";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { Check, History, Maximize2, PanelLeft, SquarePen, X } from "lucide-react";
import { getSettingsAction, listConversationsAction, saveSettingsAction } from "@/app/assistant/actions";
import { Popover } from "@/components/ui/popover";
import { callAction } from "@/lib/action-error";
import type { Conversation } from "@/services/assistant.service";
import { cn } from "@/lib/utils";
import { Composer } from "./composer";
import { AssistantMark } from "./mark";
import { PANEL_SUGGESTIONS } from "./presets";
import { Thread } from "./thread";
import { useChat, type PageInfo } from "./use-chat";

type Mode = "panel" | "page";
const MODE_KEY = "assistant:mode";
export const RETURN_KEY = "assistant:return";

const readMode = (): Mode => { try { return localStorage.getItem(MODE_KEY) === "page" ? "page" : "panel"; } catch { return "panel"; } };
const writeMode = (mode: Mode) => { try { localStorage.setItem(MODE_KEY, mode); } catch { /* التخزين غير متاح */ } };

/** ما يظهر في الصفحة الحالية باختصار، ليفهم المساعد سياق السؤال */
function pageContext(path: string): PageInfo {
  const main = document.querySelector("main");
  const title = main?.querySelector("h1")?.textContent?.trim() ?? document.title;
  const text = (main?.innerText ?? "").replace(/\s+\n/g, "\n").replace(/\n{2,}/g, "\n").replace(/[ \t]{2,}/g, " ").slice(0, 3500);
  return { path, title, text };
}

/**
 * زر المساعد في الشريط العلوي: يعرض خيارين قبل الفتح (لوحة جانبية أو صفحة كاملة) ويتذكر آخر اختيار،
 * وCtrl J يفتح آخر اختيار مباشرة. اللوحة تبقى مفتوحة بمحادثتها أثناء التنقل بين الصفحات.
 */
export function AssistantLauncher() {
  const [choosing, setChoosing] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  // يظهر فقط داخل قائمة الاختيار (لا تُرسم في الخادم)، فلا اختلاف بين الخادم والمتصفح
  const [mode, setMode] = React.useState<Mode>(() => (typeof window === "undefined" ? "panel" : readMode()));
  const button = React.useRef<HTMLButtonElement | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const chat = useChat();

  const goPage = React.useCallback((conversationId?: string | null) => {
    try { sessionStorage.setItem(RETURN_KEY, `${window.location.pathname}${window.location.search}`); } catch { /* غير متاح */ }
    router.push(conversationId ? `/assistant?c=${conversationId}` : "/assistant");
  }, [router]);

  const choose = React.useCallback((next: Mode) => {
    setChoosing(false);
    setMode(next);
    writeMode(next);
    void callAction(saveSettingsAction({ open_mode: next }));
    if (next === "page") { setOpen(false); goPage(chat.conversationId); } else setOpen(true);
  }, [goPage, chat.conversationId]);

  const toggleChooser = async () => {
    if (open) { setOpen(false); return; }
    setChoosing((v) => !v);
    const r = await callAction(getSettingsAction());
    if (r.ok) { setMode(r.data.open_mode); writeMode(r.data.open_mode); }
  };

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        if (open) setOpen(false); else choose(readMode());
      } else if (e.key === "Escape" && open) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, choose]);

  return (
    <>
      <button ref={button} type="button" onClick={toggleChooser} aria-expanded={open || choosing} aria-haspopup="menu" title={tr("المساعد، Ctrl J")}
        className={cn("group flex h-10 shrink-0 items-center gap-2 rounded-lg border border-line bg-white ps-2.5 pe-3 text-[16px] font-medium text-slate-700 transition-colors duration-200 hover:text-ink",
          (open || choosing) && "border-[#d4d1c8] text-ink")}>
        <AssistantMark thinking={chat.busy} className="size-[18px] text-ink" />
        <span className="hidden lg:inline">{tr("المساعد")}</span>
      </button>

      <Popover open={choosing} anchor={button} onClose={() => setChoosing(false)} width={320} maxHeight={320}>
        <div role="menu" aria-label={tr("طريقة فتح المساعد")}>
          <p className="px-2.5 pt-1.5 pb-2 text-[14px] text-slate-500">{tr("كيف تفتح المساعد؟")}</p>
          {([
            { key: "panel", icon: PanelLeft, title: tr("لوحة جانبية"), hint: tr("بجانب الصفحة التي تعمل عليها، ويفهم ما تراه") },
            { key: "page", icon: Maximize2, title: tr("صفحة كاملة"), hint: tr("مساحة واسعة بمحادثاتك وتقاريرك وأدواتك") },
          ] as const).map((o) => (
            <button key={o.key} type="button" role="menuitem" onClick={() => choose(o.key)}
              className="flex w-full items-start gap-3 rounded-lg px-2.5 py-2.5 text-start transition-colors hover:bg-subtle">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-white text-slate-600">
                <o.icon className="size-4 stroke-[1.8]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15.5px] font-medium text-ink">{o.title}</span>
                <span className="block text-[14px] leading-snug text-slate-500">{o.hint}</span>
              </span>
              {mode === o.key && <Check className="mt-1.5 size-4 shrink-0 text-action" />}
            </button>
          ))}
          <p className="mx-2.5 mt-1.5 border-t border-line pt-2 pb-1 text-[14px] text-slate-400">
            <kbd className="num rounded border border-line bg-panel px-1.5 text-slate-500">Ctrl J</kbd>{" "}{tr("يفتح آخر اختيار")}</p>
        </div>
      </Popover>

      <AnimatePresence>
        {open && (
          <SidePanel chat={chat} path={pathname} onClose={() => setOpen(false)}
            onExpand={() => { setOpen(false); writeMode("page"); setMode("page"); void callAction(saveSettingsAction({ open_mode: "page" })); goPage(chat.conversationId); }} />
        )}
      </AnimatePresence>
    </>
  );
}

function SidePanel({ chat, path, onClose, onExpand }: {
  chat: ReturnType<typeof useChat>; path: string; onClose: () => void; onExpand: () => void;
}) {
  const [history, setHistory] = React.useState<Conversation[] | null>(null);
  const [showHistory, setShowHistory] = React.useState(false);
  const historyBtn = React.useRef<HTMLButtonElement | null>(null);
  const scroller = React.useRef<HTMLDivElement | null>(null);
  const empty = chat.messages.length === 0;

  React.useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [chat.messages, chat.status]);

  const openHistory = async () => {
    setShowHistory((v) => !v);
    const r = await callAction(listConversationsAction());
    if (r.ok) setHistory(r.data);
  };
  const ask = (q: string) => void chat.ask(q, pageContext(path));
  const icon = "flex size-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-subtle hover:text-ink";

  return (
    <m.aside role="dialog" aria-label={tr("المساعد")}
      initial={{ opacity: 0, x: -16, scale: 0.99 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: -16, scale: 0.99 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="assistant-panel fixed inset-y-3 end-3 z-50 flex w-[min(460px,calc(100vw-24px))] flex-col overflow-hidden rounded-[20px] border border-line bg-white">
      <header className="flex h-14 shrink-0 items-center gap-2.5 ps-4 pe-2.5">
        <AssistantMark thinking={chat.busy} className="size-5 text-ink" />
        <p className="min-w-0 flex-1 truncate text-[16px] font-semibold text-ink">{chat.title || tr("المساعد")}</p>
        <button ref={historyBtn} type="button" onClick={openHistory} className={icon} title={tr("المحادثات السابقة")} aria-label={tr("المحادثات السابقة")}><History className="size-[17px]" /></button>
        <button type="button" disabled={chat.busy || empty} onClick={chat.reset} className={cn(icon, "disabled:opacity-40")} title={tr("محادثة جديدة")} aria-label={tr("محادثة جديدة")}><SquarePen className="size-[17px]" /></button>
        <button type="button" onClick={onExpand} className={icon} title={tr("فتح في صفحة كاملة")} aria-label={tr("فتح في صفحة كاملة")}><Maximize2 className="size-[17px]" /></button>
        <button type="button" onClick={onClose} className={icon} title={tr("إغلاق")} aria-label={tr("إغلاق")}><X className="size-[18px]" /></button>
      </header>

      <Popover open={showHistory} anchor={historyBtn} onClose={() => setShowHistory(false)} width={300} maxHeight={380}>
        <p className="px-2.5 pt-1.5 pb-1.5 text-[14px] text-slate-500">{tr("المحادثات السابقة")}</p>
        <div className="min-h-0 overflow-y-auto">
          {history === null && <div className="space-y-1.5 p-1.5">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-7 rounded-md" />)}</div>}
          {history?.length === 0 && <p className="px-2.5 py-2 text-[15px] text-slate-400">{tr("لا محادثات بعد")}</p>}
          {history?.slice(0, 30).map((c) => (
            <button key={c.id} type="button" onClick={() => { setShowHistory(false); void chat.load(c.id); }}
              className={cn("block w-full truncate rounded-lg px-2.5 py-2 text-start text-[15.5px] transition-colors hover:bg-subtle", c.id === chat.conversationId ? "bg-subtle font-medium text-ink" : "text-slate-700")}>
              {c.title}
            </button>
          ))}
        </div>
      </Popover>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-5 pt-2 pb-6">
        {empty ? (
          <div className="flex h-full flex-col justify-end gap-6 pb-2">
            <div className="space-y-2">
              <AssistantMark className="size-9 text-ink" />
              <p className="pt-2 text-[22px] font-bold leading-snug text-ink">{tr("كيف أساعدك؟")}</p>
              <p className="text-[15.5px] leading-relaxed text-slate-500">{tr("أفهم كل أقسام النظام وأقرأ بياناتك الحية بصلاحياتك، وأرى الصفحة التي أنت فيها الآن.")}</p>
            </div>
            <div className="-mx-2 space-y-0.5">
              {PANEL_SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => ask(s)}
                  className="block w-full rounded-lg px-2 py-2 text-start text-[15.5px] text-slate-700 transition-colors hover:bg-subtle hover:text-ink">{s}</button>
              ))}
            </div>
          </div>
        ) : chat.loading ? (
          <div className="space-y-3 pt-4">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-6 rounded-md" />)}</div>
        ) : (
          <Thread compact messages={chat.messages} busy={chat.busy} status={chat.status} conversationId={chat.conversationId}
            onRetry={() => void chat.retry(pageContext(path))} />
        )}
      </div>

      <div className="shrink-0 px-3 pb-3">
        <Composer autoFocus busy={chat.busy} onStop={chat.stop} onSend={ask} hint={tr("يقرأ بياناتك بصلاحياتك ولا ينفّذ أي عملية")} />
      </div>
    </m.aside>
  );
}
