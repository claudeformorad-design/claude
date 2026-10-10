"use client";
import { tr } from "@/i18n/tr";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { actionErrorText, callAction } from "@/lib/action-error";
import { DEFAULT_TEMPLATES, TEMPLATE_FIELDS, TEMPLATE_KEYS, type TemplateKey } from "@/lib/whatsapp";
import { saveMessageTemplateAction } from "./messages-actions";

const TITLES: Record<TemplateKey, () => string> = {
  reservation_confirm: () => tr("تأكيد الحجز"),
  arrival_reminder: () => tr("تذكير بالوصول"),
  payment_receipt: () => tr("إيصال دفعة أو عربون"),
  checkout_thanks: () => tr("شكر بعد المغادرة مع رابط التقييم"),
  balance_reminder: () => tr("تذكير الشركات بالرصيد"),
};
const FIELD_LABELS: Record<string, () => string> = {
  guest: () => tr("اسم النزيل"), hotel: () => tr("اسم الفندق"), hotel_phone: () => tr("هاتف الفندق"), confirmation: () => tr("رقم الحجز"),
  arrival: () => tr("الوصول"), departure: () => tr("المغادرة"), nights: () => tr("عدد الليالي"), room_type: () => tr("نوع الغرفة"),
  room: () => tr("رقم الغرفة"), total: () => tr("الإجمالي"), amount: () => tr("المبلغ"), method: () => tr("طريقة الدفع"),
  reference: () => tr("رقم العملية"), document: () => tr("رقم المستند"), date: () => tr("التاريخ"), invoice: () => tr("رقم الفاتورة"),
  survey_link: () => tr("رابط التقييم"), customer: () => tr("اسم العميل"), balance: () => tr("الرصيد المستحق"),
};

/** نصوص رسائل واتساب: لكل رسالة نصها، وما بين القوسين يُستبدل تلقائيًا عند الإرسال */
export function MessagesCard({ custom, errors }: { custom: Partial<Record<TemplateKey, string>>; errors: Record<string, string> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<TemplateKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState<Record<TemplateKey, string>>(
    Object.fromEntries(TEMPLATE_KEYS.map((k) => [k, custom[k] ?? DEFAULT_TEMPLATES[k]])) as Record<TemplateKey, string>);

  const save = (k: TemplateKey, body: string, done: string) => start(async () => {
    setBusy(k); setError(null);
    const r = await callAction(saveMessageTemplateAction(k, body));
    setBusy(null);
    if (r.ok) { toast(done); router.refresh(); } else setError(actionErrorText(errors, r));
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tr("رسائل واتساب")}</CardTitle>
        <CardDescription>{tr("النص الذي يظهر جاهزًا عند الضغط على زر واتساب. اضغط على أي حقل لإضافته، ويُستبدل بقيمته عند الإرسال.")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && <Alert variant="destructive">{error}</Alert>}
        {TEMPLATE_KEYS.map((k) => {
          const changed = text[k].trim() !== (custom[k] ?? DEFAULT_TEMPLATES[k]).trim();
          return (
            <div key={k} className="space-y-2 border-b border-line pb-6 last:border-0 last:pb-0">
              <Label htmlFor={`tpl_${k}`}>{TITLES[k]()}{custom[k] && <span className="ms-2 text-[13.5px] font-normal text-slate-500">{tr("نص خاص")}</span>}</Label>
              <Textarea id={`tpl_${k}`} rows={6} value={text[k]} maxLength={2000} onChange={(e) => setText({ ...text, [k]: e.target.value })} />
              <div className="flex flex-wrap gap-1.5">
                {TEMPLATE_FIELDS[k].map((f) => (
                  <button key={f} type="button" className="rounded-md bg-subtle px-2 py-1 text-[13.5px] text-slate-700 hover:bg-line"
                    onClick={() => setText({ ...text, [k]: `${text[k]}{${f}}` })}>{FIELD_LABELS[f]?.() ?? f}</button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" disabled={!changed || !text[k].trim()} loading={pending && busy === k}
                  onClick={() => save(k, text[k], tr("حُفظ النص"))}>{tr("حفظ")}</Button>
                {custom[k] && (
                  <Button type="button" size="sm" variant="ghost" disabled={pending}
                    onClick={() => { setText({ ...text, [k]: DEFAULT_TEMPLATES[k] }); save(k, "", tr("أُعيد النص الافتراضي")); }}>{tr("النص الافتراضي")}</Button>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
