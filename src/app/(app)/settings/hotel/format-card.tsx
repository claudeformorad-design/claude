"use client";
import { tr } from "@/i18n/tr";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { actionErrorText, callAction } from "@/lib/action-error";
import { factoryResetAction } from "../../_admin/actions";

const WORD = "فورمات";

/** فورمات النظام المنشور لصاحبه: كل الفنادق والموظفين والحركات تُمسح، ويبقى حسابه ليبدأ من جديد */
export function FormatCard({ errors }: { errors: Record<string, string> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // قفل فوري ضد الضغط المزدوج قبل أن يعطَّل الزر في الرسم التالي
  const running = useRef(false);
  const go = () => {
    if (running.current) return;
    running.current = true;
    start(async () => {
      setError(null);
      const r = await callAction(factoryResetAction(word));
      if (!r.ok) { running.current = false; setError(actionErrorText(errors, r)); return; }
      router.push("/onboarding");
      router.refresh();
    });
  };
  return (
    <div className="surface flex flex-wrap items-center justify-between gap-4 border-urgent/30 p-6">
      <div className="flex min-w-0 items-start gap-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-urgent-tint text-urgent"><RotateCcw className="size-5 stroke-[1.75]" /></span>
        <div className="space-y-1">
          <h3 className="text-[18.5px] font-semibold text-ink">{tr("فورمات النظام")}</h3>
          <p className="max-w-xl text-[16.5px] leading-relaxed text-slate-600">
            {tr("يمسح كل شيء ويعيد النظام جديدًا: الفنادق والموظفون والحجوزات والقيود. يبقى حسابك أنت فقط لتنشئ فندقك من جديد. لا يمكن التراجع عنه.")}
          </p>
        </div>
      </div>
      <Button variant="destructive" onClick={() => { setWord(""); setError(null); setOpen(true); }}><RotateCcw />{tr("فورمات النظام")}</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={tr("فورمات النظام")} width="sm">
        <div className="space-y-4">
          {error && <Alert variant="destructive">{error}</Alert>}
          <p className="leading-relaxed text-slate-600">{tr("كل البيانات ستُحذف نهائيًا. للتأكيد اكتب كلمة {0} في الخانة.", WORD)}</p>
          <Input value={word} onChange={(e) => setWord(e.target.value)} placeholder={WORD} aria-label={tr("كلمة التأكيد")} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>{tr("إلغاء")}</Button>
            <Button variant="destructive" loading={pending} disabled={word.trim() !== WORD} onClick={go}><RotateCcw />{tr("فورمات الآن")}</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
