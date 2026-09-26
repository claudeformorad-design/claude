"use client";

import { useActionState, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import { signInAction, signUpAction } from "./actions";

export function LoginForm({ t }: { t: Pick<Dictionary, "auth" | "errors"> }) {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [inState, signIn, signingIn] = useActionState(signInAction, null);
  const [upState, signUp, signingUp] = useActionState(signUpAction, null);
  const state = mode === "in" ? inState : upState;

  return (
    <form action={mode === "in" ? signIn : signUp} className="space-y-4">
      <h1 className="text-xl font-semibold">{mode === "in" ? t.auth.signInTitle : t.auth.signUpTitle}</h1>

      {state?.error && (
        <Alert variant="destructive">
          {state.error === "invalid"
            ? t.auth.invalidCredentials
            : state.error === "validation"
              ? t.errors.validation
              : (state.message ?? t.errors.unknown)}
        </Alert>
      )}
      {state?.info === "check_email" && <Alert variant="success">{t.auth.checkEmail}</Alert>}

      {mode === "up" && (
        <div className="space-y-2">
          <Label htmlFor="full_name">{t.auth.fullName}</Label>
          <Input id="full_name" name="full_name" autoComplete="name" />
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="email">{t.auth.email}</Label>
        <Input id="email" name="email" type="email" dir="ltr" autoComplete="email" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">{t.auth.password}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          dir="ltr"
          minLength={8}
          autoComplete={mode === "in" ? "current-password" : "new-password"}
          required
        />
      </div>
      <Button type="submit" className="w-full" disabled={signingIn || signingUp}>
        {mode === "in" ? t.auth.signIn : t.auth.signUp}
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="w-full cursor-pointer text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMode((m) => (m === "in" ? "up" : "in"));
        }}
      >
        {mode === "in" ? t.auth.noAccount : t.auth.haveAccount}
      </Button>
    </form>
  );
}
