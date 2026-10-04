"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { localSignInAction } from "./local-actions";

const MESSAGES = {
  invalid: "اسم المستخدم أو كلمة المرور غير صحيحة",
  locked: "محاولات كثيرة غير صحيحة، حاول بعد 15 دقيقة",
  inactive: "هذا الحساب موقوف، راجع مدير النظام",
  validation: "أدخل اسم المستخدم وكلمة المرور",
} as const;

export function LocalLoginForm() {
  const [state, action, pending] = useActionState(localSignInAction, null);
  return (
    <form action={action} className="space-y-4">
      <h1 className="text-xl font-semibold text-ink">تسجيل الدخول</h1>
      {state?.error && <Alert variant="destructive">{MESSAGES[state.error as keyof typeof MESSAGES] ?? MESSAGES.invalid}</Alert>}
      <div className="field-group space-y-2">
        <Label htmlFor="username">اسم المستخدم</Label>
        <Input id="username" name="username" dir="ltr" autoComplete="username" autoCapitalize="none" required autoFocus />
      </div>
      <div className="field-group space-y-2">
        <Label htmlFor="password">كلمة المرور</Label>
        <Input id="password" name="password" type="password" dir="ltr" autoComplete="current-password" required />
      </div>
      <Button type="submit" className="w-full" loading={pending}>دخول</Button>
    </form>
  );
}
