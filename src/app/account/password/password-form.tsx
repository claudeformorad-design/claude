"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changePasswordAction } from "../../login/local-actions";

const MESSAGES: Record<string, string> = {
  weak: "كلمة المرور 8 أحرف على الأقل، وفيها حرف ورقم",
  mismatch: "كلمتا المرور غير متطابقتين",
  current: "كلمة المرور الحالية غير صحيحة",
  validation: "تحقق من الحقول",
};

export function PasswordForm({ forced }: { forced: boolean }) {
  const [state, action, pending] = useActionState(changePasswordAction, null);
  return (
    <form action={action} className="space-y-4">
      {state?.error && <Alert variant="destructive">{MESSAGES[state.error] ?? MESSAGES.validation}</Alert>}
      {forced ? <input type="hidden" name="current" value="" /> : (
        <div className="field-group space-y-2">
          <Label htmlFor="current">كلمة المرور الحالية</Label>
          <Input id="current" name="current" type="password" dir="ltr" autoComplete="current-password" required />
        </div>
      )}
      <div className="field-group space-y-2">
        <Label htmlFor="password">كلمة المرور الجديدة</Label>
        <Input id="password" name="password" type="password" dir="ltr" autoComplete="new-password" required />
      </div>
      <div className="field-group space-y-2">
        <Label htmlFor="confirm">تأكيد كلمة المرور</Label>
        <Input id="confirm" name="confirm" type="password" dir="ltr" autoComplete="new-password" required />
      </div>
      <Button type="submit" className="w-full" loading={pending}>حفظ كلمة المرور</Button>
    </form>
  );
}
