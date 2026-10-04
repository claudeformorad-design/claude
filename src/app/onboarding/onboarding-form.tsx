"use client";
import { tr } from "@/i18n/tr";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import { createHotelAction } from "./actions";

/** لا توجد قيم افتراضية: كل حقل يُختار صراحة */
const COUNTRIES: [string, string][] = [
  ["SA", "السعودية"], ["YE", "اليمن"], ["AE", "الإمارات"], ["KW", "الكويت"], ["QA", "قطر"], ["BH", "البحرين"], ["OM", "عُمان"],
  ["JO", "الأردن"], ["EG", "مصر"], ["MA", "المغرب"], ["IQ", "العراق"], ["LB", "لبنان"], ["TN", "تونس"], ["DZ", "الجزائر"],
  ["SD", "السودان"], ["LY", "ليبيا"], ["SY", "سوريا"], ["PS", "فلسطين"], ["TR", "تركيا"], ["GB", "المملكة المتحدة"], ["US", "الولايات المتحدة"],
];
const TIMEZONES: [string, string][] = [
  ["Asia/Riyadh", "الرياض، +03:00"], ["Asia/Aden", "عدن وصنعاء، +03:00"], ["Asia/Dubai", "دبي، +04:00"], ["Asia/Kuwait", "الكويت، +03:00"],
  ["Asia/Qatar", "الدوحة، +03:00"], ["Asia/Bahrain", "المنامة، +03:00"], ["Asia/Muscat", "مسقط، +04:00"], ["Asia/Amman", "عمّان، +03:00"],
  ["Asia/Baghdad", "بغداد، +03:00"], ["Asia/Beirut", "بيروت"], ["Africa/Cairo", "القاهرة"], ["Africa/Casablanca", "الدار البيضاء"],
  ["Africa/Tunis", "تونس، +01:00"], ["Africa/Algiers", "الجزائر، +01:00"], ["Africa/Khartoum", "الخرطوم، +02:00"], ["Africa/Tripoli", "طرابلس، +02:00"],
  ["Asia/Damascus", "دمشق، +03:00"], ["Asia/Gaza", "غزة"], ["Europe/Istanbul", "إسطنبول، +03:00"], ["Europe/London", "لندن"],
  ["America/New_York", "نيويورك"], ["UTC", "التوقيت العالمي UTC"],
];

const MODULES = [
  { value: "accounting", get title() { return tr("المحاسبة"); }, get description() { return tr("دليل الحسابات والقيود، الفوليو والفواتير، المشتريات والرواتب، الأصول والمخزون، والتقارير المالية."); } },
  { value: "pms", get title() { return tr("إدارة الفندق"); }, get description() { return tr("الحجوزات والنزلاء، الغرف وحالاتها، الأسعار والمواسم، قائمة الانتظار، والقاعات بالساعة."); } },
] as const;

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
      <div className="field-group space-y-2">
        <Label htmlFor="name_ar">{t.onboarding.nameAr}</Label>
        <Input id="name_ar" name="name_ar" required dir="rtl" />
      </div>
      <div className="field-group space-y-2">
        <Label htmlFor="name_en">{t.onboarding.nameEn}</Label>
        <Input id="name_en" name="name_en" dir="ltr" />
      </div>
      <div className="field-group space-y-2">
        <Label htmlFor="country_code">{t.onboarding.country}</Label>
        <NativeSelect id="country_code" name="country_code" defaultValue="" required>
          <option value="" disabled>{tr("اختر الدولة")}</option>
          {COUNTRIES.map(([code, name]) => <option key={code} value={code}>{tr(name)}</option>)}
        </NativeSelect>
      </div>
      <div className="field-group space-y-2">
        <Label htmlFor="base_currency">{t.onboarding.baseCurrency}</Label>
        <NativeSelect id="base_currency" name="base_currency" defaultValue="" required>
          <option value="" disabled>{tr("اختر العملة")}</option>
          {currencies.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} {c.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="field-group space-y-2">
        <Label htmlFor="fiscal_year_start_month">{t.onboarding.fiscalStartMonth}</Label>
        <NativeSelect id="fiscal_year_start_month" name="fiscal_year_start_month" defaultValue="" required>
          <option value="" disabled>{tr("اختر الشهر")}</option>
          {t.months.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="field-group space-y-2">
        <Label htmlFor="timezone">{t.onboarding.timezone}</Label>
        <NativeSelect id="timezone" name="timezone" defaultValue="" required lang={locale}>
          <option value="" disabled>{tr("اختر المنطقة الزمنية")}</option>
          {TIMEZONES.map(([tz, name]) => <option key={tz} value={tz}>{tr(name)}</option>)}
        </NativeSelect>
      </div>
      <fieldset className="space-y-2 sm:col-span-2">
        <legend className="mb-2 text-[16.5px] font-medium text-ink">{tr("الأقسام المطلوبة")}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {MODULES.map((m) => (
            <label key={m.value} className="flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-white p-4 transition-colors hover:border-line-strong has-[:checked]:border-action has-[:checked]:bg-accent1-tint/40">
              <input type="checkbox" name="modules" value={m.value} defaultChecked className="mt-1 size-4" />
              <span className="min-w-0">
                <span className="block text-[16.5px] font-semibold text-ink">{m.title}</span>
                <span className="mt-0.5 block text-[15px] leading-relaxed text-slate-600">{m.description}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="text-[14.5px] text-slate-500">{tr("يمكن تفعيل أي قسم أو إيقافه لاحقًا من إعدادات الفندق، والبيانات محفوظة في النظام نفسه.")}</p>
      </fieldset>
      <Button type="submit" className="sm:col-span-2" loading={pending}>
        {t.onboarding.submit}
      </Button>
    </form>
  );
}
