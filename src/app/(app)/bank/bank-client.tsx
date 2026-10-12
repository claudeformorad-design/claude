"use client";
import { tr } from "@/i18n/tr";

import { useRef, useState, useTransition } from "react";
import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import { type BankImportCheck, addBankLineAction, bankMatchAction, importBankStatementAction } from "../_payables/actions";
import { actionErrorText, callAction } from "@/lib/action-error";
import { toast } from "@/components/ui/toast";

type T = Pick<Dictionary, "payables" | "common" | "errors" | "folio">;

export function AddBankLine({ t, accountId, today }: { t: T; accountId: string; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, reset } = useForm({ defaultValues: { txn_date: today, description: "", reference: "", amount: "" } });
  return (
    <form className="space-y-2" onSubmit={handleSubmit((v) => start(async () => {
      const r = await callAction(addBankLineAction({ ...v, account_id: accountId }));
      if (r.ok) { toast(tr("تمت إضافة سطر الكشف")); reset({ txn_date: v.txn_date, description: "", reference: "", amount: "" }); router.refresh(); }
      else setError(actionErrorText(t.errors, r));
    }))}>
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Input type="date" dir="ltr" className="w-52" {...register("txn_date")} />
        <Input className="w-64" placeholder={t.common.description} {...register("description")} />
        <Input className="w-36" dir="ltr" placeholder={t.common.reference} {...register("reference")} />
        <Input className="num w-36" dir="ltr" placeholder={tr("المبلغ")} {...register("amount")} />
        <Button type="submit" loading={pending}>{t.payables.addLine}</Button>
      </div>
    </form>
  );
}

export function AutoMatch({ label, accountId }: { label: string; accountId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return <Button variant="outline" loading={pending} onClick={() => start(async () => { await callAction(bankMatchAction("auto", { accountId })); router.refresh(); })}>{label}</Button>;
}

export function LineActions({ t, lineId, matched, candidates }: { t: T; lineId: string; matched: boolean; candidates: { id: string; label: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sel, setSel] = useState("");
  const run = (op: "match" | "unmatch" | "delete", ledgerLineId?: string) =>
    start(async () => { const r = await callAction(bankMatchAction(op, { lineId, ledgerLineId })); if (!r.ok) alert(actionErrorText(t.errors, r)); router.refresh(); });
  if (matched) return <Button size="sm" variant="ghost" loading={pending} onClick={() => run("unmatch")}>✕</Button>;
  return (
    <div className="flex gap-1">
      {candidates.length > 0 && (
        <>
          <NativeSelect className="h-8 w-56" value={sel} onChange={(e) => setSel(e.target.value)}><option value="">{tr("اختر")}</option>{candidates.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</NativeSelect>
          <Button size="sm" loading={pending} disabled={pending || !sel} onClick={() => run("match", sel)}>{t.payables.matched}</Button>
        </>
      )}
      <Button size="sm" variant="ghost" loading={pending} onClick={() => run("delete")}>{t.common.delete}</Button>
    </div>
  );
}

/**
 * استيراد كشف البنك من ملف البنك (Excel أو CSV): يُقرأ ويُعرض أولًا دون حفظ، ثم يُستورد ويُطابق تلقائيًا.
 */
export function BankImport({ accountId, decimals }: { accountId: string; decimals: number }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<BankImportCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const form = (f: File, mode: "check" | "run") => { const fd = new FormData(); fd.set("account_id", accountId); fd.set("file", f); fd.set("mode", mode); return fd; };
  const money = (v: string) => Number(v).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const pick = (f: File | undefined) => {
    if (!f) return;
    setFile(f); setCheck(null); setError(null);
    start(async () => {
      const r = await callAction(importBankStatementAction(form(f, "check")));
      if (r.ok) setCheck(r.data as BankImportCheck); else setError(r.message ?? tr("تعذّرت قراءة الملف"));
    });
  };
  const run = () => file && start(async () => {
    const r = await callAction(importBankStatementAction(form(file, "run")));
    if (!r.ok) { setError(r.message ?? tr("تعذّر الاستيراد")); return; }
    const d = r.data as { inserted: number; matched: number };
    toast(tr("استُورد {0} سطر، وطوبق منها {1} تلقائيًا", d.inserted, d.matched));
    setFile(null); setCheck(null); if (input.current) input.current.value = "";
    router.refresh();
  });
  return (
    <div className="space-y-3" data-testid="bank-import">
      <div className="flex flex-wrap items-center gap-3">
        <input ref={input} type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => pick(e.target.files?.[0])} data-testid="bank-import-file" />
        <Button type="button" variant="outline" loading={pending && !check} onClick={() => input.current?.click()}><Upload />{tr("استيراد كشف البنك")}</Button>
        <span className="text-[14.5px] text-slate-500">{file ? file.name : tr("ملف Excel أو CSV كما يصدّره البنك: التاريخ والبيان والمبلغ، أو عمودا الإيداع والسحب")}</span>
      </div>
      {error && <Alert variant="destructive">{error}</Alert>}
      {check && (
        <div className="space-y-3 rounded-lg border border-line bg-panel/50 p-4">
          <p className="text-[14.5px] text-slate-600">
            {tr("الأعمدة المعروفة:")}{" "}<b>{check.columns.date}</b>{check.columns.description && <>{tr("، ")}<b>{check.columns.description}</b></>}
            {check.columns.reference && <>{tr("، ")}<b>{check.columns.reference}</b></>}{tr("، ")}<b>{check.columns.amount}</b>
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-[15px]">
            <span>{tr("أسطر جديدة")}{": "}<b className="num">{check.fresh}</b></span>
            <span className="text-success">{tr("إيداعات")}{": "}<b className="num">{money(check.deposits)}</b></span>
            <span>{tr("سحوبات")}{": "}<b className="num">{money(check.withdrawals)}</b></span>
            {check.duplicates > 0 && <span className="text-slate-500">{tr("مستوردة من قبل وتُتخطى")}{": "}<b className="num">{check.duplicates}</b></span>}
            {check.skipped > 0 && <span className="text-slate-500">{tr("صفوف أرصدة ومجاميع تُتخطى")}{": "}<b className="num">{check.skipped}</b></span>}
          </div>
          {check.errors.length > 0 && (
            <Alert variant="destructive">
              {tr("في الملف أخطاء، صحّحها ثم ارفعه مرة أخرى:")}
              <ul className="mt-1 list-disc ps-5">{check.errors.slice(0, 8).map((e) => <li key={e.line}>{tr("الصف {0}: {1}", e.line, e.message)}</li>)}</ul>
            </Alert>
          )}
          {check.sample.length > 0 && (
            <ul className="divide-y divide-line rounded-md border border-line bg-white text-[14.5px]">
              {check.sample.map((l) => (
                <li key={l.line} className={`flex items-center gap-3 px-3 py-2 ${l.duplicate ? "text-slate-400" : ""}`}>
                  <span className="num w-24 shrink-0">{l.txn_date}</span>
                  <span className="min-w-0 flex-1 truncate">{l.description}{l.duplicate && ` (${tr("مستورد")})`}</span>
                  <span className={`num shrink-0 font-semibold ${Number(l.amount) < 0 ? "" : "text-success"}`} dir="ltr">{money(l.amount)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <Button type="button" onClick={run} loading={pending} disabled={!check.fresh || check.errors.length > 0} data-testid="bank-import-run">
              {tr("استيراد {0} سطر ومطابقتها", check.fresh)}
            </Button>
            <Button type="button" variant="ghost" onClick={() => { setCheck(null); setFile(null); if (input.current) input.current.value = ""; }}>{tr("إلغاء")}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
