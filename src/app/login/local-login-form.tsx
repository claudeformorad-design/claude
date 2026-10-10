"use client";
import { tr } from "@/i18n/tr";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { localSignInAction } from "./local-actions";

const MESSAGES = {
  get invalid() { return tr("اسم المستخدم أو كلمة المرور غير صحيحة"); },
  get locked() { return tr("محاولات كثيرة غير صحيحة، حاول بعد 15 دقيقة"); },
  get inactive() { return tr("هذا الحساب موقوف، راجع مدير النظام"); },
  get validation() { return tr("أدخل اسم المستخدم وكلمة المرور"); },
} as const;

export function LocalLoginForm() {
  const [state, action, pending] = useActionState(localSignInAction, null);
  return (
    <form action={action} className="space-y-5">
      <h1 className="sr-only">{tr("تسجيل الدخول")}</h1>
      {state?.error && <Alert variant="destructive">{MESSAGES[state.error as keyof typeof MESSAGES] ?? MESSAGES.invalid}</Alert>}
      <div className="field-group space-y-2">
        <Label htmlFor="username">{tr("اسم المستخدم")}</Label>
        <Input id="username" name="username" dir="ltr" autoComplete="username" autoCapitalize="none" required autoFocus />
      </div>
      <div className="field-group space-y-2">
        <Label htmlFor="password">{tr("كلمة المرور")}</Label>
        <Input id="password" name="password" type="password" dir="ltr" autoComplete="current-password" required />
      </div>
      <Button type="submit" className="h-[52px] w-full rounded-xl bg-ink text-[18px] font-semibold text-white hover:bg-black" loading={pending}>{tr("دخول")}</Button>
    </form>
  );
}
