"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import { signInAction } from "./actions";

/** الدخول باسم المستخدم (أو البريد) وكلمة المرور التي اختارها صاحب الحساب. الحسابات تُنشأ من داخل النظام فقط */
export function LoginForm({ t }: { t: Pick<Dictionary, "auth" | "errors"> }) {
  const [state, signIn, signingIn] = useActionState(signInAction, null);
  return (
    <form action={signIn} className="space-y-4">
      <h1 className="text-xl font-semibold">{t.auth.signInTitle}</h1>
      {state?.error && (
        <Alert variant="destructive">
          {state.error === "invalid" ? t.auth.invalidCredentials : state.error === "validation" ? t.errors.validation : (state.message ?? t.errors.unknown)}
        </Alert>
      )}
      <div className="field-group space-y-2">
        <Label htmlFor="email">{t.auth.emailOrUsername}</Label>
        <Input id="email" name="email" type="text" dir="ltr" autoCapitalize="none" autoComplete="username" required />
      </div>
      <div className="field-group space-y-2">
        <Label htmlFor="password">{t.auth.password}</Label>
        <Input id="password" name="password" type="password" dir="ltr" maxLength={72} autoComplete="current-password" required />
      </div>
      <Button type="submit" className="w-full" disabled={signingIn}>{t.auth.signIn}</Button>
      <p className="text-center text-[14.5px] text-slate-500">{t.auth.noPasswordHint}</p>
    </form>
  );
}
