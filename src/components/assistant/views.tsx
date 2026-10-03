"use client";

import * as React from "react";
import { BookOpen, ChevronLeft, Copy, MessageSquare, Trash2 } from "lucide-react";
import { deleteSavedAction, listSavedAction, saveSettingsAction } from "@/app/assistant/actions";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { callAction } from "@/lib/action-error";
import type { AssistantSettings, SavedAnswer } from "@/services/assistant.service";
import { cn } from "@/lib/utils";
import { Markdown } from "./markdown";
import { PROCESSES, SMART_REPORTS, TERMS, explainProcess, explainSection, explainTerm, fixProblem } from "./presets";

export type Section = { label: string; group: string };

function Head({ title, text }: { title: string; text: string }) {
  return (
    <header className="mb-8 space-y-2 pt-6">
      <h1 className="text-[28px] font-bold leading-tight text-ink">{title}</h1>
      <p className="text-[16.5px] leading-relaxed text-slate-500">{text}</p>
    </header>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-[15px] font-semibold text-slate-500">{children}</h2>;
}

export function ReportsView({ onAsk }: { onAsk: (q: string) => void }) {
  return (
    <>
      <Head title="التقارير الذكية" text="اختر تقريرًا، ويكتبه لك المساعد الآن من بيانات الفندق الحية بعناوين وجداول وتوصيات." />
      <div className="space-y-3">
        {SMART_REPORTS.map((r) => (
          <button key={r.key} type="button" onClick={() => onAsk(r.prompt)}
            className="group flex w-full items-center gap-4 rounded-2xl border border-line bg-white p-5 text-start transition-colors hover:border-[#d4d1c8] hover:bg-[#fcfbf9]">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-subtle text-slate-600 group-hover:text-ink"><r.icon className="size-5 stroke-[1.8]" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[17px] font-semibold text-ink">{r.title}</span>
              <span className="block text-[15px] text-slate-500">{r.hint}</span>
            </span>
            <ChevronLeft className="size-5 shrink-0 text-slate-300 transition-colors group-hover:text-slate-500" />
          </button>
        ))}
      </div>
    </>
  );
}

export function LearnView({ sections, onAsk }: { sections: Section[]; onAsk: (q: string) => void }) {
  const [term, setTerm] = React.useState("");
  const groups = [...new Set(sections.map((s) => s.group))];
  const chip = "rounded-full border border-line bg-white px-3.5 py-1.5 text-[15px] text-slate-700 transition-colors hover:border-[#d4d1c8] hover:bg-subtle hover:text-ink";
  return (
    <>
      <Head title="الشرح والتعلم" text="تعلّم النظام بالطريقة التي تناسبك: شرح أي قسم، أو خطوات أي عملية، أو معنى أي مصطلح." />

      <section className="mb-10">
        <Label>اشرح لي قسمًا</Label>
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g}>
              <p className="mb-2 text-[14.5px] text-slate-400">{g}</p>
              <div className="flex flex-wrap gap-2">
                {sections.filter((s) => s.group === g).map((s) => (
                  <button key={s.label} type="button" onClick={() => onAsk(explainSection(s.label))} className={chip}>{s.label}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-10">
        <Label>خطوة بخطوة</Label>
        <div className="overflow-hidden rounded-2xl border border-line">
          {PROCESSES.map((p, i) => (
            <button key={p} type="button" onClick={() => onAsk(explainProcess(p))}
              className={cn("group flex w-full items-center gap-3 px-4 py-3 text-start text-[15.5px] text-slate-700 transition-colors hover:bg-[#fcfbf9] hover:text-ink", i > 0 && "border-t border-line")}>
              <span className="num w-6 shrink-0 text-slate-400">{i + 1}</span>
              <span className="flex-1">{p}</span>
              <ChevronLeft className="size-4 text-slate-300 group-hover:text-slate-500" />
            </button>
          ))}
        </div>
      </section>

      <section>
        <Label>قاموس المصطلحات</Label>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (term.trim()) onAsk(explainTerm(term.trim())); }}>
          <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="اكتب أي مصطلح محاسبي أو فندقي" className="field h-11 flex-1" />
          <Button type="submit" variant="dark" disabled={!term.trim()}><BookOpen />اشرح</Button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          {TERMS.map((t) => <button key={t} type="button" onClick={() => onAsk(explainTerm(t))} className={chip}>{t}</button>)}
        </div>
      </section>
    </>
  );
}

export function FixView({ sections, onAsk }: { sections: Section[]; onAsk: (q: string) => void }) {
  const [problem, setProblem] = React.useState("");
  const [where, setWhere] = React.useState("");
  return (
    <>
      <Head title="حل مشكلة" text="صف ما حدث أو الصق رسالة الخطأ كما ظهرت، ويشخّصها المساعد من بياناتك ويعطيك الحل خطوة بخطوة." />
      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); if (problem.trim()) onAsk(fixProblem(problem.trim(), where || undefined)); }}>
        <div className="space-y-2">
          <label htmlFor="fix-where" className="text-[15.5px] font-medium text-ink">أين ظهرت المشكلة؟</label>
          <NativeSelect id="fix-where" value={where} onChange={(e) => setWhere(e.target.value)}>
            <option value="">لا أعرف أو في أكثر من قسم</option>
            {sections.map((s) => <option key={`${s.group}-${s.label}`} value={s.label}>{s.label}</option>)}
          </NativeSelect>
        </div>
        <div className="space-y-2">
          <label htmlFor="fix-text" className="text-[15.5px] font-medium text-ink">ماذا حدث؟</label>
          <textarea id="fix-text" value={problem} onChange={(e) => setProblem(e.target.value)} rows={6} maxLength={4000}
            placeholder="مثال: عند مغادرة النزيل ظهرت رسالة يجب تسوية رصيد الفوليو قبل المغادرة مع أنه دفع كامل المبلغ"
            className="field block w-full resize-y py-3 leading-relaxed" />
        </div>
        <Button type="submit" variant="dark" disabled={!problem.trim()}>شخّص المشكلة</Button>
      </form>
    </>
  );
}

export function SavedView({ onOpen }: { onOpen: (conversationId: string) => void }) {
  const [items, setItems] = React.useState<SavedAnswer[] | null>(null);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  React.useEffect(() => { void callAction(listSavedAction()).then((r) => setItems(r.ok ? r.data : [])); }, []);

  const remove = async (id: string) => {
    const r = await callAction(deleteSavedAction(id));
    if (r.ok) { setItems((x) => x?.filter((i) => i.id !== id) ?? null); toast("حُذفت من المحفوظات"); }
  };
  const tool = "flex h-8 items-center gap-1.5 rounded-md px-2 text-[14.5px] text-slate-500 transition-colors hover:bg-subtle hover:text-ink";

  return (
    <>
      <Head title="المحفوظات" text="الإجابات التي حفظتها من محادثاتك، مرجع ثابت تعود إليه متى شئت." />
      {items === null && <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="skeleton h-32 rounded-2xl" />)}</div>}
      {items?.length === 0 && (
        <div className="rounded-2xl border border-dashed border-line px-6 py-12 text-center">
          <p className="text-[16.5px] font-medium text-ink">لا محفوظات بعد</p>
          <p className="mt-1 text-[15px] text-slate-500">احفظ أي إجابة مهمة بعلامة الحفظ تحتها في المحادثة.</p>
        </div>
      )}
      <div className="space-y-4">
        {items?.map((s) => {
          const open = expanded.has(s.id);
          return (
            <article key={s.id} className="rounded-2xl border border-line bg-white p-5">
              {s.question && <p className="mb-3 line-clamp-2 text-[15px] text-slate-500">{s.question}</p>}
              <div className={cn("relative", !open && "max-h-56 overflow-hidden")}>
                <Markdown text={s.content} />
                {!open && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white" />}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-line pt-3">
                <button type="button" className={tool} onClick={() => setExpanded((x) => { const n = new Set(x); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n; })}>
                  {open ? "عرض أقل" : "عرض الكل"}
                </button>
                <button type="button" className={tool} onClick={() => { void navigator.clipboard.writeText(s.content); toast("نُسخت الإجابة"); }}><Copy className="size-4" />نسخ</button>
                {s.conversation_id && <button type="button" className={tool} onClick={() => onOpen(s.conversation_id!)}><MessageSquare className="size-4" />فتح المحادثة</button>}
                <button type="button" className={cn(tool, "ms-auto hover:bg-urgent-tint hover:text-urgent")} onClick={() => remove(s.id)}><Trash2 className="size-4" />حذف</button>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}

const EXAMPLES = ["اختصر الإجابات قدر الإمكان", "أنا مدير الفندق، ركّز على الأرقام الكبيرة والقرارات", "اذكر المبالغ باسم العملة دائمًا", "اشرح بلغة بسيطة كأنني جديد في المحاسبة"];

export function InstructionsView({ initial }: { initial: AssistantSettings }) {
  const [text, setText] = React.useState(initial.instructions);
  const [mode, setMode] = React.useState(initial.open_mode);
  const [saving, setSaving] = React.useState(false);
  const save = async () => {
    setSaving(true);
    const r = await callAction(saveSettingsAction({ instructions: text, open_mode: mode }));
    setSaving(false);
    if (r.ok) { try { localStorage.setItem("assistant:mode", mode); } catch { /* غير متاح */ } toast("حُفظت تعليماتك"); }
    else toast("تعذّر الحفظ", "error");
  };
  return (
    <>
      <Head title="التعليمات الخاصة" text="اكتب كيف تحب أن يجيبك المساعد، ويلتزم بها في كل محادثاتك. لا يراها غيرك." />
      <div className="space-y-2">
        <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, 2000))} rows={7}
          placeholder="مثال: أنا المحاسب الرئيسي، أجبني بالأرقام أولًا ثم التفسير، واقترح دائمًا خطوة المراجعة التالية"
          className="field block w-full resize-y py-3 leading-relaxed" />
        <p className="text-end text-[14px] text-slate-400"><span className="num">{text.length}</span> من <span className="num">2000</span> حرف</p>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {EXAMPLES.map((x) => (
          <button key={x} type="button" onClick={() => setText((t) => (t.trim() ? `${t.trim()}\n${x}` : x).slice(0, 2000))}
            className="rounded-full border border-line px-3.5 py-1.5 text-[14.5px] text-slate-600 transition-colors hover:bg-subtle hover:text-ink">{x}</button>
        ))}
      </div>

      <section className="mt-10">
        <Label>طريقة الفتح من الشريط العلوي</Label>
        <div className="grid gap-3 sm:grid-cols-2">
          {([["panel", "لوحة جانبية", "بجانب الصفحة التي تعمل عليها"], ["page", "صفحة كاملة", "مساحة واسعة بمحادثاتك وأدواتك"]] as const).map(([k, title, hint]) => (
            <button key={k} type="button" onClick={() => setMode(k)} aria-pressed={mode === k}
              className={cn("rounded-2xl border p-4 text-start transition-colors", mode === k ? "border-ink bg-white" : "border-line hover:bg-[#fcfbf9]")}>
              <span className="block text-[16px] font-semibold text-ink">{title}</span>
              <span className="block text-[14.5px] text-slate-500">{hint}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="mt-8"><Button variant="dark" loading={saving} onClick={save}>حفظ التعليمات</Button></div>
    </>
  );
}
