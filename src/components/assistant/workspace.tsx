"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight, Bookmark, FileBarChart, GraduationCap, LifeBuoy, Menu, MoreHorizontal, Pin, PinOff, Search, SlidersHorizontal, SquarePen, Trash2, X,
} from "lucide-react";
import { deleteConversationAction, listConversationsAction, updateConversationAction } from "@/app/assistant/actions";
import { Popover } from "@/components/ui/popover";
import { toast } from "@/components/ui/toast";
import { callAction } from "@/lib/action-error";
import type { AssistantSettings, Conversation } from "@/services/assistant.service";
import { cn } from "@/lib/utils";
import { Composer } from "./composer";
import { RETURN_KEY } from "./launcher";
import { AssistantMark } from "./mark";
import { SMART_REPORTS } from "./presets";
import { Thread } from "./thread";
import { useChat } from "./use-chat";
import { FixView, InstructionsView, LearnView, ReportsView, SavedView, type Section } from "./views";

type View = "home" | "chat" | "reports" | "learn" | "fix" | "saved" | "instructions";
const PAGE = { path: "/assistant", title: "صفحة المساعد الكاملة" };

const TOOLS: { view: View; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { view: "reports", label: "التقارير الذكية", icon: FileBarChart },
  { view: "learn", label: "الشرح والتعلم", icon: GraduationCap },
  { view: "fix", label: "حل مشكلة", icon: LifeBuoy },
  { view: "saved", label: "المحفوظات", icon: Bookmark },
  { view: "instructions", label: "التعليمات الخاصة", icon: SlidersHorizontal },
];

/** تجميع المحادثات: المثبتة، ثم حسب قِدمها */
function groupConversations(list: Conversation[]) {
  const day = 86_400_000;
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const t0 = start.getTime();
  const groups: { title: string; items: Conversation[] }[] = [
    { title: "المثبتة", items: [] }, { title: "اليوم", items: [] }, { title: "أمس", items: [] }, { title: "آخر 7 أيام", items: [] }, { title: "أقدم", items: [] },
  ];
  for (const c of list) {
    const t = Date.parse(c.updated_at);
    const g = c.pinned ? 0 : t >= t0 ? 1 : t >= t0 - day ? 2 : t >= t0 - 7 * day ? 3 : 4;
    groups[g]!.items.push(c);
  }
  return groups.filter((g) => g.items.length);
}

/**
 * صفحة المساعد الكاملة: شريط جانبي خاص (محادثة جديدة، بحث، الأدوات، المحادثات، والعودة للنظام)،
 * ومساحة رئيسية للبداية أو المحادثة أو إحدى الأدوات.
 */
export function Workspace({ enabled, userName, hotelName, initialConversation, conversations, settings, sections }: {
  enabled: boolean;
  userName: string;
  hotelName: string;
  initialConversation?: string;
  conversations: Conversation[];
  settings: AssistantSettings;
  sections: Section[];
}) {
  const router = useRouter();
  const [view, setView] = React.useState<View>(initialConversation ? "chat" : "home");
  const [list, setList] = React.useState(conversations);
  const [query, setQuery] = React.useState("");
  const [drawer, setDrawer] = React.useState(false);
  const scroller = React.useRef<HTMLDivElement | null>(null);

  const refresh = React.useCallback(async () => {
    const r = await callAction(listConversationsAction());
    if (r.ok) setList(r.data);
  }, []);
  const chat = useChat(() => void refresh());

  const { load } = chat;
  React.useEffect(() => { if (initialConversation) void load(initialConversation); }, [initialConversation, load]);
  React.useEffect(() => {
    const url = view === "chat" && chat.conversationId ? `/assistant?c=${chat.conversationId}` : "/assistant";
    window.history.replaceState(null, "", url);
  }, [view, chat.conversationId]);
  React.useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [chat.messages, chat.status]);

  const go = (v: View) => { setView(v); setDrawer(false); };
  const ask = (q: string) => { go("chat"); void chat.ask(q, PAGE); };
  /** التقارير والشرح وحل المشكلات تبدأ دائمًا محادثة مستقلة باسمها */
  const askFresh = (q: string) => { chat.reset(); ask(q); };
  const newChat = () => { chat.reset(); go("home"); };
  const open = (id: string) => { go("chat"); void chat.load(id); };
  const exit = () => {
    let back = "/";
    try { back = sessionStorage.getItem(RETURN_KEY) || "/"; } catch { /* غير متاح */ }
    router.push(back);
  };

  const shown = query.trim() ? list.filter((c) => c.title.includes(query.trim())) : list;
  const firstName = userName.trim().split(/\s+/)[0] || "";
  const greeting = new Date().getHours() < 12 ? "صباح الخير" : "مساء الخير";

  const sidebar = (
    <aside className="flex h-full w-[284px] shrink-0 flex-col border-e border-line bg-[#fbfaf8]">
      <div className="flex h-14 shrink-0 items-center gap-2.5 px-4">
        <AssistantMark thinking={chat.busy} className="size-[22px] text-ink" />
        <p className="flex-1 text-[17px] font-semibold text-ink">المساعد</p>
        <button type="button" onClick={() => setDrawer(false)} className="flex size-8 items-center justify-center rounded-md text-slate-500 hover:bg-subtle lg:hidden" aria-label="إغلاق القائمة"><X className="size-[18px]" /></button>
      </div>

      <div className="space-y-2 px-3">
        <button type="button" onClick={newChat}
          className="flex h-10 w-full items-center gap-2.5 rounded-lg border border-line bg-white px-3 text-[15.5px] font-medium text-ink transition-colors hover:border-[#d4d1c8]">
          <SquarePen className="size-[17px] text-slate-600" />محادثة جديدة
        </button>
        <label className="flex h-9 items-center gap-2 rounded-lg px-3 text-slate-400 transition-colors focus-within:bg-white focus-within:ring-1 focus-within:ring-line hover:bg-subtle/70">
          <Search className="size-4 shrink-0" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="بحث في المحادثات"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-slate-400" />
        </label>
      </div>

      <nav className="mt-4 space-y-0.5 px-3" aria-label="أدوات المساعد">
        {TOOLS.map((tl) => (
          <button key={tl.view} type="button" onClick={() => go(tl.view)}
            className={cn("flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-[15.5px] transition-colors",
              view === tl.view ? "bg-subtle font-medium text-ink" : "text-slate-600 hover:bg-subtle/70 hover:text-ink")}>
            <tl.icon className="size-[17px] shrink-0 stroke-[1.8]" />{tl.label}
          </button>
        ))}
      </nav>

      <div className="mt-5 min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {groupConversations(shown).map((g) => (
          <section key={g.title} className="mb-4">
            <p className="px-3 pb-1 text-[14px] font-medium text-slate-400">{g.title}</p>
            {g.items.map((c) => (
              <ConversationRow key={c.id} c={c} active={view === "chat" && c.id === chat.conversationId} onOpen={() => open(c.id)}
                onChanged={refresh} onDeleted={() => { if (c.id === chat.conversationId) newChat(); void refresh(); }} />
            ))}
          </section>
        ))}
        {shown.length === 0 && <p className="px-3 text-[14.5px] text-slate-400">{query ? "لا نتائج" : "محادثاتك تظهر هنا"}</p>}
      </div>

      <div className="shrink-0 border-t border-line p-3">
        <button type="button" onClick={exit}
          className="flex h-10 w-full items-center gap-2.5 rounded-lg px-3 text-[15.5px] text-slate-600 transition-colors hover:bg-subtle hover:text-ink">
          <ArrowRight className="size-[17px]" />العودة للنظام
        </button>
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen bg-white">
      <div className="hidden lg:block">{sidebar}</div>
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" aria-label="إغلاق القائمة" className="absolute inset-0 bg-ink/20" onClick={() => setDrawer(false)} />
          <div className="relative h-full w-fit">{sidebar}</div>
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 px-4 lg:px-8">
          <button type="button" onClick={() => setDrawer(true)} className="flex size-9 items-center justify-center rounded-md text-slate-600 hover:bg-subtle lg:hidden" aria-label="القائمة"><Menu className="size-5" /></button>
          <p className="min-w-0 truncate text-[16px] font-medium text-slate-600">{view === "chat" ? chat.title : ""}</p>
        </header>

        {!enabled ? (
          <div className="flex flex-1 items-center justify-center px-6">
            <div className="max-w-md space-y-3 text-center">
              <AssistantMark className="mx-auto size-10 text-ink" />
              <p className="text-[22px] font-bold text-ink">المساعد غير مفعّل بعد</p>
              <p className="text-[16px] leading-relaxed text-slate-500">يحتاج مفتاح مزود الذكاء الاصطناعي على الخادم، GEMINI_API_KEY أو OPENROUTER_API_KEY. اطلب من المسؤول التقني ضبطه ثم أعد فتح الصفحة.</p>
            </div>
          </div>
        ) : view === "home" ? (
          <div className="flex min-h-0 flex-1 overflow-y-auto">
            <div className="m-auto w-full max-w-[720px] px-6 py-10">
              <AssistantMark className="size-10 text-ink" />
              <h1 className="mt-5 text-[32px] font-bold leading-tight text-ink">{greeting}{firstName ? `، ${firstName}` : ""}</h1>
              <p className="mt-2 text-[17px] text-slate-500">اسألني عن أي قسم أو رقم أو مشكلة في {hotelName}</p>
              <Composer autoFocus className="mt-8" busy={chat.busy} onStop={chat.stop} onSend={ask} hint="يقرأ بياناتك الحية بصلاحياتك ولا ينفّذ أي عملية" />
              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                {SMART_REPORTS.map((r) => (
                  <button key={r.key} type="button" onClick={() => askFresh(r.prompt)}
                    className="group flex items-start gap-3 rounded-2xl border border-line bg-white p-4 text-start transition-colors hover:border-[#d4d1c8] hover:bg-[#fcfbf9]">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-subtle text-slate-600 transition-colors group-hover:text-ink"><r.icon className="size-[18px] stroke-[1.8]" /></span>
                    <span className="min-w-0">
                      <span className="block text-[15.5px] font-semibold text-ink">{r.title}</span>
                      <span className="block text-[14px] leading-snug text-slate-500">{r.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {TOOLS.filter((x) => x.view !== "reports").map((x) => (
                  <button key={x.view} type="button" onClick={() => go(x.view)}
                    className="flex h-9 items-center gap-2 rounded-full border border-line px-3.5 text-[15px] text-slate-600 transition-colors hover:bg-subtle hover:text-ink">
                    <x.icon className="size-4 stroke-[1.8]" />{x.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : view === "chat" ? (
          <>
            <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto w-full max-w-[760px] px-6 pt-6 pb-10">
                {chat.loading
                  ? <div className="space-y-4">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-6 rounded-md" />)}</div>
                  : <Thread messages={chat.messages} busy={chat.busy} status={chat.status} conversationId={chat.conversationId} onRetry={() => void chat.retry(PAGE)} />}
              </div>
            </div>
            <div className="shrink-0 px-6 pb-5">
              <Composer autoFocus className="mx-auto max-w-[760px]" busy={chat.busy} onStop={chat.stop} onSend={ask} placeholder="اكتب رسالتك"
                hint="راجع الأرقام المهمة من شاشاتها قبل الاعتماد عليها" />
            </div>
          </>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[760px] px-6 pt-6 pb-16">
              {view === "reports" && <ReportsView onAsk={askFresh} />}
              {view === "learn" && <LearnView sections={sections} onAsk={askFresh} />}
              {view === "fix" && <FixView sections={sections} onAsk={askFresh} />}
              {view === "saved" && <SavedView onOpen={open} />}
              {view === "instructions" && <InstructionsView initial={settings} />}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function ConversationRow({ c, active, onOpen, onChanged, onDeleted }: {
  c: Conversation; active: boolean; onOpen: () => void; onChanged: () => void; onDeleted: () => void;
}) {
  const [menu, setMenu] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [title, setTitle] = React.useState(c.title);
  const btn = React.useRef<HTMLButtonElement | null>(null);

  const rename = async () => {
    setEditing(false);
    if (!title.trim() || title.trim() === c.title) { setTitle(c.title); return; }
    const r = await callAction(updateConversationAction(c.id, { title: title.trim() }));
    if (!r.ok) toast("تعذّر تغيير الاسم", "error");
    onChanged();
  };
  const pin = async () => { setMenu(false); await callAction(updateConversationAction(c.id, { pinned: !c.pinned })); onChanged(); };
  const remove = async () => {
    setMenu(false);
    if (!window.confirm("حذف هذه المحادثة نهائيًا؟ الإجابات المحفوظة منها تبقى في المحفوظات.")) return;
    const r = await callAction(deleteConversationAction(c.id));
    if (r.ok) { toast("حُذفت المحادثة"); onDeleted(); } else toast("تعذّر حذف المحادثة", "error");
  };

  if (editing) {
    return (
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onBlur={rename}
        onKeyDown={(e) => { if (e.key === "Enter") void rename(); if (e.key === "Escape") { setTitle(c.title); setEditing(false); } }}
        className="h-9 w-full rounded-lg border border-line bg-white px-3 text-[15px] text-ink outline-none" />
    );
  }
  return (
    <div className={cn("group relative flex h-9 items-center rounded-lg transition-colors", active ? "bg-subtle" : "hover:bg-subtle/70")}>
      <button type="button" onClick={onOpen} className={cn("min-w-0 flex-1 truncate px-3 text-start text-[15px]", active ? "font-medium text-ink" : "text-slate-600")}>
        {c.title}
      </button>
      <button ref={btn} type="button" onClick={() => setMenu((v) => !v)} aria-label="خيارات المحادثة"
        className={cn("me-1 flex size-7 shrink-0 items-center justify-center rounded-md text-slate-400 transition-opacity hover:bg-line hover:text-ink",
          menu ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100")}>
        <MoreHorizontal className="size-4" />
      </button>
      <Popover open={menu} anchor={btn} onClose={() => setMenu(false)} width={200}>
        <button type="button" onClick={pin} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[15px] text-slate-700 hover:bg-subtle">
          {c.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}{c.pinned ? "إلغاء التثبيت" : "تثبيت"}
        </button>
        <button type="button" onClick={() => { setMenu(false); setEditing(true); }} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[15px] text-slate-700 hover:bg-subtle">
          <SquarePen className="size-4" />إعادة تسمية
        </button>
        <button type="button" onClick={remove} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[15px] text-urgent hover:bg-urgent-tint">
          <Trash2 className="size-4" />حذف
        </button>
      </Popover>
    </div>
  );
}
