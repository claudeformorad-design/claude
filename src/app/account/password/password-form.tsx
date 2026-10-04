"use client";
import { tr } from "@/i18n/tr";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changePasswordAction } from "../../login/local-actions";

const MESSAGES: Record<string, string> = {
  get weak() { return tr("كلمة المرور 8 أحرف على الأقل، وفيها حرف ورقم"); },
  get mismatch() { return tr("كلمتا المرور غير متطابقتين"); },
  get current() { return tr("كلمة المرور الحالية غير صحيحة"); },
  get validation() { return tr("تحقق من الحقول"); },
};

export function PasswordForm({ forced }: { forced: boolean }) {
  const [state, action, pending] = useActionState(changePasswordAction, null);
  return (
    <form action={action} className="space-y-4">
      {state?.error && <Alert variant="destructive">{MESSAGES[state.error] ?? MESSAGES.validation}</Alert>}
      {forced ? <input type="hidden" name="current" value="" /> : (
        <div className="field-group space-y-2">
          <Label htmlFor="current">{tr("كلمة المرور الحالية")}</Label>
          <Input id="current" name="current" type="password" dir="ltr" autoComplete="current-password" required />
        </div>
      )}
      <div className="field-group space-y-2">
        <Label htmlFor="password">{tr("كلمة المرور الجديدة")}</Label>
        <Input id="password" name="password" type="password" dir="ltr" autoComplete="new-password" required />
      </div>
      <div className="field-group space-y-2">
        <Label htmlFor="confirm">{tr("تأكيد كلمة المرور")}</Label>
        <Input id="confirm" name="confirm" type="password" dir="ltr" autoComplete="new-password" required />
      </div>
      <Button type="submit" className="w-full" loading={pending}>{tr("حفظ كلمة المرور")}</Button>
    </form>
  );
}
