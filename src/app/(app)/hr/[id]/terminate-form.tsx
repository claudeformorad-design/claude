"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useDialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { actionErrorText, callAction } from "@/lib/action-error";
import { formatMoney } from "@/lib/accounting/money";
import type { SettlementQuote } from "@/services/hr.service";
import { settlementQuoteAction, terminateAction } from "../actions";

/** إنهاء الخدمة: معاينة حية للتسوية (المكافأة ونسبتها، تعويض الإجازة، السلف) قبل الاعتماد */
export function TerminateForm({ employeeId, today, errors }: { employeeId: string; today: string; errors: Record<string, string> }) {
  const router = useRouter();
  const close = useDialogClose();
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState<"resignation" | "termination">("resignation");
  const [notes, setNotes] = useState("");
  const [quote, setQuote] = useState<SettlementQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    void callAction(settlementQuoteAction(employeeId, date, reason)).then((r) => {
      if (!live) return;
      if (r.ok) { setQuote(r.data); setError(null); } else { setQuote(null); setError(actionErrorText(errors, r)); }
    });
    return () => { live = false; };
  }, [employeeId, date, reason, errors]);

  const confirm = () => start(async () => {
    const r = await callAction(terminateAction({ employee_id: employeeId, date, reason, notes }));
    if (r.ok) { toast("سُجّلت التسوية النهائية وقيدها"); close?.(); router.refresh(); }
    else setError(actionErrorText(errors, r));
  });

  const money = (v: number) => <span className="num font-semibold text-ink">{formatMoney(v)}</span>;
  const row = (label: React.ReactNode, value: React.ReactNode, strong = false) => (
    <div className={`flex items-center justify-between gap-4 py-2.5 ${strong ? "border-t border-line text-[17px] font-semibold" : "text-[16px]"}`}>
      <span className="text-slate-600">{label}</span>{value}
    </div>
  );

  return (
    <div className="space-y-4">
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="field-group space-y-1.5"><Label htmlFor="end-date">تاريخ نهاية الخدمة</Label><Input id="end-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="field-group space-y-1.5"><Label htmlFor="end-reason">السبب</Label>
          <NativeSelect id="end-reason" value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
            <option value="resignation">استقالة</option><option value="termination">إنهاء من المنشأة</option>
          </NativeSelect></div>
        <div className="field-group space-y-1.5 md:col-span-2"><Label htmlFor="end-notes">ملاحظات</Label><Input id="end-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      </div>
      {quote && (
        <div className="rounded-xl bg-panel px-4 py-2">
          {row(<>مدة الخدمة <span className="num">{quote.years.toFixed(2)}</span> سنة على أجر <span className="num">{formatMoney(quote.wage)}</span></>, null)}
          {row(<>مكافأة نهاية الخدمة{quote.pct < 100 && <> بنسبة <span className="num">{quote.pct}</span>٪ للاستقالة</>}</>, money(quote.amount))}
          {row(<>تعويض رصيد الإجازات <span className="num">{quote.leave_days}</span> يومًا</>, money(quote.leave_amount))}
          {row("خصم السلف المتبقية", money(-quote.advances_recovered))}
          {row("صافي المستحق للموظف", money(quote.net), true)}
          {quote.advances_left > 0 && <p className="pb-2 text-[14.5px] text-amber">يبقى على الموظف من السلف <span className="num">{formatMoney(quote.advances_left)}</span> بعد التسوية.</p>}
        </div>
      )}
      <p className="text-[14.5px] leading-relaxed text-slate-500">يُقيَّد المستحق على مخصص نهاية الخدمة، ويُسجَّل الصافي في الرواتب المستحقة ليُصرف بسند صرف، وتُغلق السلف المخصومة.</p>
      <Button variant="destructive" onClick={confirm} loading={pending} disabled={!quote}>اعتماد إنهاء الخدمة</Button>
    </div>
  );
}
