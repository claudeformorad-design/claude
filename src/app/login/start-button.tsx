"use client";
import { tr } from "@/i18n/tr";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { claimOwnerAction } from "./actions";

/** «ابدأ»: أول من يضغطه على النظام الجديد يصبح صاحبه، ثم يختفي هذا الزر نهائيًا */
export function StartButton() {
  const [state, action, pending] = useActionState(claimOwnerAction, null);
  return (
    <form action={action} className="space-y-3">
      {state?.message && <Alert variant="destructive">{state.message}</Alert>}
      <Button type="submit" className="w-full" loading={pending}>{tr("ابدأ")}</Button>
    </form>
  );
}
