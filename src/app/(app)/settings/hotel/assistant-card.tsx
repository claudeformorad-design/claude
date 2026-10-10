"use client";
import { tr } from "@/i18n/tr";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { AssistantMark } from "@/components/assistant/mark";
import { actionErrorText, callAction } from "@/lib/action-error";
import { removeAssistantKeyAction, saveAssistantKeyAction, testAssistantAction } from "./assistant-actions";

export type AssistantKeyState = { source: "env" | "settings" | null; provider: "gemini" | "openrouter" | null; masked: string | null; model: string | null };

const PROVIDER = { gemini: "Google Gemini", openrouter: "OpenRouter" } as const;

/**
 * مفتاح المساعد الذكي لصاحب النظام: يُلصق هنا، يُجرَّب مع المزود قبل حفظه، ويُحفظ على الخادم فقط.
 * لا يعود المفتاح للمتصفح بعد الحفظ، ويظهر منه آخر أربعة أحرف فقط.
 */
export function AssistantCard({ state, errors }: { state: AssistantKeyState; errors: Record<string, string> }) {
  const router = useRouter();
  const [editing, setEditing] = useState(state.source === null);
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [saving, startSave] = useTransition();
  const [testing, startTest] = useTransition();
  const [removing, startRemove] = useTransition();
  const busy = saving || testing || removing;

  const save = () => startSave(async () => {
    setError(null); setNote(null);
    if (!key.trim()) { setError(tr("الصق المفتاح أولًا.")); return; }
    const r = await callAction(saveAssistantKeyAction({ key: key.trim(), model: model.trim() || undefined }));
    if (!r.ok) { setError(actionErrorText(errors, r)); return; }
    setKey(""); setModel(""); setEditing(false);
    if (r.data.warning) setNote({ ok: false, text: r.data.warning });
    toast(tr("تم تفعيل المساعد الذكي"));
    router.refresh();
  });

  const test = () => startTest(async () => {
    setError(null); setNote(null);
    const r = await callAction(testAssistantAction());
    setNote(r.ok ? { ok: true, text: tr("الاتصال يعمل، والمساعد جاهز للأسئلة.") } : { ok: false, text: actionErrorText(errors, r) });
  });

  const remove = () => startRemove(async () => {
    const r = await callAction(removeAssistantKeyAction());
    setConfirmRemove(false);
    if (!r.ok) { setError(actionErrorText(errors, r)); return; }
    setNote(null); setEditing(true);
    toast(tr("تم حذف المفتاح وإيقاف المساعد"));
    router.refresh();
  });

  return (
    <section id="assistant" className="surface scroll-mt-24 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-ink text-white"><AssistantMark className="size-5" /></span>
          <div className="min-w-0 space-y-1">
            <h3 className="flex flex-wrap items-center gap-2 text-[18.5px] font-semibold text-ink">
              {tr("المساعد الذكي")}
              {state.source ? <Badge variant="success">{tr("مفعّل")}</Badge> : <Badge variant="warning">{tr("غير مفعّل")}</Badge>}
            </h3>
            <p className="max-w-2xl text-[16.5px] leading-relaxed text-slate-600">
              {tr("يجيب عن أسئلة الموظفين من بيانات الفندق، كلٌّ حسب صلاحياته. يعمل بمفتاح من Google Gemini أو OpenRouter، ويُحفظ المفتاح على الخادم فقط ولا يراه أي مستخدم.")}
            </p>
          </div>
        </div>
      </div>

      {state.source && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-panel/60 px-4 py-3.5">
          <div className="min-w-0 space-y-0.5">
            <p className="font-medium text-ink">{state.provider ? PROVIDER[state.provider] : ""}</p>
            <p className="text-[15.5px] text-slate-500">
              {state.source === "env" ? tr("المفتاح مضبوط في إعدادات الخادم") : tr("المفتاح محفوظ من هذه الصفحة")}
              {state.masked && <span dir="ltr" className="ms-2 rounded-md bg-white px-1.5 py-0.5 font-mono text-[14px] text-slate-600">{state.masked}</span>}
            </p>
            {state.model && <p className="text-[15px] text-slate-500">{tr("النموذج")} <span dir="ltr" className="font-mono text-[14px]">{state.model}</span></p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" loading={testing} disabled={busy} onClick={test}>{tr("اختبار الاتصال")}</Button>
            {state.source === "settings" && !editing && (
              <>
                <Button variant="secondary" disabled={busy} onClick={() => { setEditing(true); setNote(null); setError(null); }}>{tr("تغيير المفتاح")}</Button>
                <Button variant="ghost" className="text-urgent hover:text-urgent" disabled={busy} onClick={() => setConfirmRemove(true)}>{tr("حذف المفتاح")}</Button>
              </>
            )}
          </div>
        </div>
      )}

      {note && <Alert variant={note.ok ? "success" : "warning"} className="mt-4">{note.text}</Alert>}

      {editing && state.source !== "env" && (
        <form className="mt-5 space-y-4" onSubmit={(e) => { e.preventDefault(); if (!busy) save(); }}>
          {error && <Alert variant="destructive">{error}</Alert>}
          <div className="max-w-2xl space-y-2">
            <Label htmlFor="assistant-key">{tr("مفتاح الذكاء الاصطناعي")}</Label>
            <Input id="assistant-key" type="password" dir="ltr" autoComplete="off" spellCheck={false} value={key}
              onChange={(e) => setKey(e.target.value)} placeholder="AIza…" className="font-mono" maxLength={300} />
            <p className="text-[15px] leading-relaxed text-slate-500">
              {tr("تحصل على مفتاح Gemini مجانًا من")}{" "}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer noopener" className="font-medium text-action hover:underline">Google AI Studio</a>
              {tr("، ثم الصقه هنا. نجرّبه مع المزود قبل الحفظ.")}
            </p>
          </div>
          <details className="group rounded-lg">
            <summary className="cursor-pointer select-none text-[15.5px] text-slate-600 hover:text-ink">{tr("إعدادات متقدمة")}</summary>
            <div className="mt-3 max-w-md space-y-2">
              <Label htmlFor="assistant-model">{tr("اسم النموذج (اختياري)")}</Label>
              <Input id="assistant-model" dir="ltr" autoComplete="off" spellCheck={false} value={model} onChange={(e) => setModel(e.target.value)}
                placeholder="gemini-flash-latest" className="font-mono" maxLength={120} />
              <p className="text-[15px] text-slate-500">{tr("اتركه فارغًا ليُستخدم أحدث نموذج سريع تلقائيًا.")}</p>
            </div>
          </details>
          <div className="flex flex-wrap justify-end gap-2">
            {state.source === "settings" && <Button type="button" variant="ghost" disabled={busy} onClick={() => { setEditing(false); setKey(""); setError(null); }}>{tr("إلغاء")}</Button>}
            <Button type="submit" variant="dark" loading={saving} disabled={busy || !key.trim()}>{saving ? tr("جارٍ التجربة") : tr("حفظ وتفعيل")}</Button>
          </div>
        </form>
      )}

      {state.source === "env" && (
        <p className="mt-4 text-[15px] leading-relaxed text-slate-500">{tr("لتغيير هذا المفتاح عدّله في متغيرات بيئة الخادم، أو احذفه هناك لتضيف مفتاحًا من هذه الصفحة.")}</p>
      )}

      <Dialog open={confirmRemove} onClose={() => setConfirmRemove(false)} title={tr("حذف مفتاح المساعد")} width="sm">
        <div className="space-y-5">
          <p className="leading-relaxed text-slate-600">{tr("سيتوقف المساعد عن العمل لكل الموظفين حتى تضيف مفتاحًا جديدًا. المحادثات المحفوظة تبقى كما هي.")}</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmRemove(false)}>{tr("إلغاء")}</Button>
            <Button variant="destructive" loading={removing} onClick={remove}>{tr("حذف المفتاح")}</Button>
          </div>
        </div>
      </Dialog>
    </section>
  );
}
