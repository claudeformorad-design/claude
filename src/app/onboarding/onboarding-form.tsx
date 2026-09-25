"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import { createHotelAction } from "./actions";

export function OnboardingForm({
  t,
  currencies,
  locale,
}: {
  t: Pick<Dictionary, "onboarding" | "errors" | "months">;
  currencies: { code: string; name: string }[];
  locale: string;
}) {
  const [state, action, pending] = useActionState(createHotelAction, null);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      {state?.error && (
        <Alert variant="destructive" className="sm:col-span-2">
          {state.error === "validation" ? t.errors.validation : state.error}
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor="name_ar">{t.onboarding.nameAr}</Label>
        <Input id="name_ar" name="name_ar" required dir="rtl" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="name_en">{t.onboarding.nameEn}</Label>
        <Input id="name_en" name="name_en" dir="ltr" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="country_code">{t.onboarding.country}</Label>
        <Input id="country_code" name="country_code" defaultValue="SA" maxLength={2} dir="ltr" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="base_currency">{t.onboarding.baseCurrency}</Label>
        <NativeSelect id="base_currency" name="base_currency" defaultValue="SAR">
          {currencies.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} — {c.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-2">
        <Label htmlFor="fiscal_year_start_month">{t.onboarding.fiscalStartMonth}</Label>
        <NativeSelect id="fiscal_year_start_month" name="fiscal_year_start_month" defaultValue="1">
          {t.months.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-2">
        <Label htmlFor="timezone">{t.onboarding.timezone}</Label>
        <Input id="timezone" name="timezone" defaultValue="Asia/Riyadh" dir="ltr" required lang={locale} />
      </div>
      <Button type="submit" className="sm:col-span-2" disabled={pending}>
        {t.onboarding.submit}
      </Button>
    </form>
  );
}
