"use client";
import { tr } from "@/i18n/tr";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { claimOwnerAction } from "./actions";

/** «ابدأ»: يدخل صاحب النظام من هذا الجهاز. يبقى متاحًا حتى يضع كلمة مرور */
export function StartButton() {
  const [state, action, pending] = useActionState(claimOwnerAction, null);
  return (
    <form action={action} className="space-y-3">
      {state?.message && <Alert variant="destructive">{state.message}</Alert>}
      <Button type="submit" className="h-[52px] w-full rounded-xl bg-ink text-[18px] font-semibold text-white hover:bg-black" loading={pending}>{tr("ابدأ")}</Button>
    </form>
  );
}
