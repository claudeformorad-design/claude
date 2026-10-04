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
      <Button type="submit" className="w-full" loading={pending}>{tr("دخول")}</Button>
    </form>
  );
}
