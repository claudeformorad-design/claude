"use client";
import { tr } from "@/i18n/tr";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import { ACCOUNT_SUBTYPES, ACCOUNT_TYPES, validateAccountPlacement, type AccountType } from "@/lib/accounting/accounts";
import { accountFormSchema, type AccountFormInput, type AccountFormValues } from "@/lib/validation/account";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import { saveAccountAction } from "./actions";
import { actionErrorText, callAction } from "@/lib/action-error";
import { toast } from "@/components/ui/toast";

export interface AccountOption {
  id: string;
  code: string;
  name: string;
  account_type: AccountType;
  is_postable: boolean;
  parent_id: string | null;
  depth: number;
}

export function AccountForm({
  t,
  accounts,
  departments,
  initial,
}: {
  t: Pick<Dictionary, "accounts" | "common" | "errors">;
  accounts: AccountOption[];
  departments: { id: string; label: string }[];
  initial: AccountFormInput;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<AccountFormInput, unknown, AccountFormValues>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: initial,
  });
  const { register, handleSubmit, control, setValue, formState } = form;
  const type = useWatch({ control, name: "account_type" }) as AccountType;
  const subtype = useWatch({ control, name: "account_subtype" });
  const parentId = useWatch({ control, name: "parent_id" });

  // الحسابات الرئيسية الممكنة: تجميعية ومن نفس النوع وليست الحساب نفسه أو أحد فروعه
  const parentOptions = useMemo(
    () =>
      accounts.filter(
        (a) => !a.is_postable && validateAccountPlacement({ id: initial.id, account_type: type }, a.id, accounts) === null,
      ),
    [accounts, type, initial.id],
  );

  useEffect(() => {
    if (!(ACCOUNT_SUBTYPES[type] as readonly string[]).includes(subtype)) {
      setValue("account_subtype", ACCOUNT_SUBTYPES[type][0]);
    }
    if (parentId && !parentOptions.some((p) => p.id === parentId)) setValue("parent_id", "");
  }, [type, subtype, parentId, parentOptions, setValue]);

  // نرسل القيم الخام (قبل التحويل) لأن الخادم يعيد التحقق بنفس المخطط
  const onSubmit = () => {
    setServerError(null);
    startTransition(async () => {
      const result = await callAction(saveAccountAction(form.getValues()));
      if (result.ok) { toast(tr("تم حفظ الحساب")); router.push("/accounts"); }
      else setServerError(actionErrorText(t.errors, result));
    });
  };

  const err = (name: keyof AccountFormInput) => formState.errors[name]?.message;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {serverError && <Alert variant="destructive">{serverError}</Alert>}

      <div className="grid grid-cols-2 gap-3">
        <div className="field-group space-y-1.5">
          <Label htmlFor="type">{t.accounts.type}</Label>
          <NativeSelect id="type" {...register("account_type")}>
            {ACCOUNT_TYPES.map((v) => (
              <option key={v} value={v}>{t.accounts.types[v]}</option>
            ))}
          </NativeSelect>
        </div>
        <div className="field-group space-y-1.5">
          <Label htmlFor="subtype">{t.accounts.subtype}</Label>
          <NativeSelect id="subtype" {...register("account_subtype")}>
            {ACCOUNT_SUBTYPES[type].map((v) => (
              <option key={v} value={v}>{t.accounts.subtypes[v]}</option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <div className="field-group space-y-1.5">
        <Label htmlFor="parent">{t.accounts.parent}</Label>
        <NativeSelect id="parent" {...register("parent_id")}>
          <option value="">{t.accounts.noParent}</option>
          {parentOptions.map((a) => (
            <option key={a.id} value={a.id}>
              {"  ".repeat(a.depth)}{a.code} {a.name}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="field-group space-y-1.5">
        <Label htmlFor="code">{t.accounts.code}</Label>
        <Input id="code" dir="ltr" inputMode="numeric" aria-invalid={!!err("code")} {...register("code")} />
      </div>
      <div className="field-group space-y-1.5">
        <Label htmlFor="name_ar">{t.accounts.nameAr}</Label>
        <Input id="name_ar" dir="rtl" aria-invalid={!!err("name_ar")} {...register("name_ar")} />
      </div>
      <div className="field-group space-y-1.5">
        <Label htmlFor="name_en">{t.accounts.nameEn}</Label>
        <Input id="name_en" dir="ltr" {...register("name_en")} />
      </div>
      <div className="field-group space-y-1.5">
        <Label htmlFor="department">{t.accounts.department}</Label>
        <NativeSelect id="department" {...register("department_id")}>
          <option value="">{t.common.none}</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.label}</option>
          ))}
        </NativeSelect>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4" {...register("is_postable")} />
        {t.accounts.postable}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4" {...register("is_active")} />
        {t.common.active}
      </label>

      {Object.keys(formState.errors).length > 0 && <p className="text-sm text-destructive">{t.errors.validation}</p>}

      <div className="flex gap-2">
        <Button type="submit" loading={pending}>{t.common.save}</Button>
        <Button type="button" variant="outline" onClick={() => router.push("/accounts")}>
          {t.common.cancel}
        </Button>
      </div>
    </form>
  );
}
