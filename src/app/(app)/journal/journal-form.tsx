"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import { formatMoney } from "@/lib/accounting/money";
import { isBlankLine, validateJournalEntry } from "@/lib/accounting/journal";
import {
  emptyJournalLine,
  journalEntryDraftSchema,
  type JournalEntryFormValues,
} from "@/lib/validation/journal-entry";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import { saveJournalEntryAction } from "./actions";

export interface JournalFormProps {
  t: Pick<Dictionary, "journal" | "common" | "errors">;
  locale: string;
  baseCurrency: string;
  currencies: string[];
  accounts: { id: string; label: string; postable: boolean; depth: number; departmentId: string | null }[];
  departments: { id: string; label: string }[];
  initial: JournalEntryFormValues;
  entryId?: string;
  canPost: boolean;
}

export function JournalForm({
  t, locale, baseCurrency, currencies, accounts, departments, initial, entryId, canPost,
}: JournalFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<JournalEntryFormValues>({
    // التوازن يُعرض حيًا ويُشترط عند الترحيل فقط (زر الترحيل معطّل حتى يتوازن القيد)
    resolver: zodResolver(journalEntryDraftSchema),
    defaultValues: initial,
    mode: "onSubmit",
  });
  const { register, control, handleSubmit, setValue, formState } = form;
  const { fields, append, remove } = useFieldArray({ control, name: "lines" });
  const lines = useWatch({ control, name: "lines" });
  const currency = useWatch({ control, name: "currency_code" });

  const postable = useMemo(() => new Set(accounts.filter((a) => a.postable).map((a) => a.id)), [accounts]);
  const defaultDept = useMemo(() => new Map(accounts.map((a) => [a.id, a.departmentId])), [accounts]);

  // التحقق الحي من التوازن أثناء الكتابة (نفس منطق lib/accounting المستخدم في الخادم)
  const live = useMemo(
    () => validateJournalEntry(lines.filter((l) => !isBlankLine(l)), { postableAccountIds: postable }),
    [lines, postable],
  );
  const fmt = (v: Parameters<typeof formatMoney>[0]) => formatMoney(v, { locale, decimals: 2 });

  const submit = (post: boolean) =>
    handleSubmit((values) => {
      setServerError(null);
      startTransition(async () => {
        const result = await saveJournalEntryAction(values, { entryId, post });
        if (result.ok) router.push(`/journal/${result.data}`);
        else setServerError(result.error === "validation" ? t.errors.validation : t.errors[result.error]);
      });
    });

  return (
    <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
      {serverError && <Alert variant="destructive">{serverError}</Alert>}

      <div className="grid gap-4 md:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="entry_date">{t.journal.entryDate}</Label>
          <Input id="entry_date" type="date" dir="ltr" {...register("entry_date")} aria-invalid={!!formState.errors.entry_date} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reference">
            {t.common.reference} <span className="text-xs text-muted-foreground">({t.common.optional})</span>
          </Label>
          <Input id="reference" {...register("reference")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="currency_code">{t.common.currency}</Label>
          <NativeSelect
            id="currency_code"
            {...register("currency_code", {
              onChange: (e) => e.target.value === baseCurrency && setValue("exchange_rate", "1"),
            })}
          >
            {currencies.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="exchange_rate" title={t.journal.exchangeRateHint}>{t.journal.exchangeRate}</Label>
          <Input
            id="exchange_rate"
            dir="ltr"
            inputMode="decimal"
            disabled={currency === baseCurrency}
            aria-invalid={!!formState.errors.exchange_rate}
            {...register("exchange_rate")}
          />
        </div>
        <div className="space-y-1.5 md:col-span-4">
          <Label htmlFor="description">{t.common.description}</Label>
          <Input id="description" {...register("description")} aria-invalid={!!formState.errors.description} />
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-muted-foreground">
            <tr>
              <th className="w-10 px-2 py-2 text-start">#</th>
              <th className="min-w-64 px-2 py-2 text-start">{t.journal.account}</th>
              <th className="min-w-40 px-2 py-2 text-start">{t.journal.department}</th>
              <th className="min-w-48 px-2 py-2 text-start">{t.common.description}</th>
              <th className="w-36 px-2 py-2 text-start">{t.journal.debit}</th>
              <th className="w-36 px-2 py-2 text-start">{t.journal.credit}</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {fields.map((field, index) => {
              const lineErrors = formState.errors.lines?.[index];
              return (
                <tr key={field.id} className="border-t">
                  <td className="num px-2 py-1.5 text-muted-foreground">{index + 1}</td>
                  <td className="px-2 py-1.5">
                    <NativeSelect
                      aria-invalid={!!lineErrors?.account_id}
                      {...register(`lines.${index}.account_id`, {
                        onChange: (e) => {
                          // اقتراح مركز التكلفة الافتراضي للحساب
                          const dept = defaultDept.get(e.target.value);
                          if (dept && !lines[index]?.department_id) setValue(`lines.${index}.department_id`, dept);
                        },
                      })}
                    >
                      <option value="">{t.journal.selectAccount}</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id} disabled={!a.postable}>
                          {"  ".repeat(a.depth)}{a.label}
                        </option>
                      ))}
                    </NativeSelect>
                    {lineErrors?.account_id?.message && (
                      <p className="mt-1 text-xs text-destructive">
                        {t.journal.lineErrors[lineErrors.account_id.message as keyof typeof t.journal.lineErrors] ?? t.errors.required}
                      </p>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <NativeSelect {...register(`lines.${index}.department_id`)}>
                      <option value="">{t.common.none}</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>{d.label}</option>
                      ))}
                    </NativeSelect>
                  </td>
                  <td className="px-2 py-1.5">
                    <Input {...register(`lines.${index}.description`)} />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      dir="ltr"
                      inputMode="decimal"
                      className="num"
                      aria-invalid={!!lineErrors?.debit}
                      {...register(`lines.${index}.debit`, {
                        onChange: (e) => e.target.value && setValue(`lines.${index}.credit`, ""),
                      })}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      dir="ltr"
                      inputMode="decimal"
                      className="num"
                      aria-invalid={!!lineErrors?.debit}
                      {...register(`lines.${index}.credit`, {
                        onChange: (e) => e.target.value && setValue(`lines.${index}.debit`, ""),
                      })}
                    />
                    {lineErrors?.debit?.message && (
                      <p className="mt-1 text-xs text-destructive">
                        {t.journal.lineErrors[lineErrors.debit.message as keyof typeof t.journal.lineErrors] ?? lineErrors.debit.message}
                      </p>
                    )}
                  </td>
                  <td className="px-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title={t.journal.removeLine}
                      disabled={fields.length <= 2}
                      onClick={() => remove(index)}
                    >
                      <Trash2 />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t bg-muted/40 font-semibold">
            <tr>
              <td colSpan={4} className="px-2 py-2">
                <div className="flex items-center gap-3">
                  <Button type="button" variant="outline" size="sm" onClick={() => append(emptyJournalLine())}>
                    <Plus />{t.journal.addLine}
                  </Button>
                  <span className="ms-auto">{t.journal.totals}</span>
                </div>
              </td>
              <td className="num px-3 py-2">{fmt(live.totals.debit)}</td>
              <td className="num px-3 py-2">{fmt(live.totals.credit)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={live.totals.isBalanced && !live.totals.debit.isZero() ? "success" : "destructive"}>
          {live.totals.isBalanced && !live.totals.debit.isZero() ? t.journal.balanced : t.journal.unbalanced}
        </Badge>
        {!live.totals.isBalanced && (
          <span className="text-sm text-destructive">
            {t.journal.difference}: <span className="num">{fmt(live.totals.difference.abs())}</span> {currency}
          </span>
        )}
        {live.entryErrors
          .filter((code) => code !== "not_balanced")
          .map((code) => (
            <span key={code} className="text-sm text-muted-foreground">
              {t.journal.entryErrors[code]}
            </span>
          ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={pending} onClick={submit(false)}>
          {t.common.saveDraft}
        </Button>
        {canPost && (
          <Button type="button" disabled={pending || !live.valid} onClick={submit(true)}>
            {t.common.saveAndPost}
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          {t.common.cancel}
        </Button>
      </div>
    </form>
  );
}
