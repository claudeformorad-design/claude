"use client";
import { tr } from "@/i18n/tr";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { redeemLinkAction } from "../../login/actions";

export function JoinButton({ token }: { token: string }) {
  const [state, action, pending] = useActionState(redeemLinkAction.bind(null, token), null);
  return (
    <form action={action} className="space-y-3">
      {state?.message && <Alert variant="destructive">{state.message}</Alert>}
      <Button type="submit" className="h-14 w-full rounded-xl text-[19px] font-semibold shadow-[0_10px_30px_-10px_rgba(36,131,225,0.7)]" loading={pending}>{tr("دخول")}</Button>
    </form>
  );
}
