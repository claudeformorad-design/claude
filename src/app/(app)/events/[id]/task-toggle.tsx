"use client";
import { tr } from "@/i18n/tr";

import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/toast";
import { actionErrorText, callAction } from "@/lib/action-error";
import { toggleEventTaskAction } from "../../_services/actions";

/** إنجاز مهمة تجهيز أو إعادتها */
export function TaskToggle({ eventId, taskId, done, label, disabled, errors }: {
  eventId: string; taskId: string; done: boolean; label: string; disabled?: boolean; errors: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // الحالة تتغير فورًا ثم تُثبَّت من الخادم، وتعود كما كانت إن فشل الحفظ
  const [checked, setChecked] = useOptimistic(done);
  return (
    <input type="checkbox" className="size-4" aria-label={tr("إنجاز {0}", label)} checked={checked} disabled={disabled || pending}
      onChange={(e) => {
        const next = e.target.checked;
        start(async () => {
          setChecked(next);
          const r = await callAction(toggleEventTaskAction(eventId, taskId, next));
          if (r.ok) router.refresh(); else toast(actionErrorText(errors, r), "error");
        });
      }} />
  );
}
