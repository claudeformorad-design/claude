"use client";
import { tr } from "@/i18n/tr";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import type { ActionResult } from "@/services/errors";
import { actionErrorText, callAction } from "@/lib/action-error";
import { toast } from "@/components/ui/toast";
import { useDialogClose } from "@/components/ui/dialog";

export type Field =
  | { name: string; label: string; type?: "text" | "date" | "number" | "month" | "time" | "datetime-local"; ltr?: boolean }
  | { name: string; label: string; options: { id: string; label: string }[]; optional?: boolean }
  | { name: string; label: string; checkbox: true };

/**
 * نموذج بسيط موحّد (React Hook Form) لشاشات الأصول والمخزون.
 * الإرسال لـ Server Action تعيد التحقق بـ Zod؛ رسائل الخطأ مترجمة من errors.
 */
export function SimpleForm({
  fields, initial, submitLabel, action, errors, onDone, columns = 2,
}: {
  fields: Field[];
  initial: Record<string, string | boolean>;
  submitLabel: string;
  action: (v: Record<string, string | boolean>) => Promise<ActionResult<unknown>>;
  errors: Record<string, string>;
  onDone?: string;
  columns?: 1 | 2 | 4;
}) {
  const router = useRouter();
  const closeDialog = useDialogClose();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, reset } = useForm({ defaultValues: initial });
  return (
    <form
      className={`grid gap-3 ${columns === 4 ? "md:grid-cols-4" : columns === 2 ? "md:grid-cols-2" : ""}`}
      onSubmit={handleSubmit((v) => start(async () => {
        setError(null);
        const r = await callAction(action(v));
        if (r.ok) { toast(tr("تم الحفظ بنجاح")); closeDialog?.(); if (onDone) router.push(onDone); else { reset(initial); router.refresh(); } }
        else setError(actionErrorText(errors, r));
      }))}
    >
      {error && <Alert variant="destructive" className="md:col-span-full">{error}</Alert>}
      {fields.map((f) =>
        "checkbox" in f ? (
          <label key={f.name} className="flex items-center gap-2 self-end text-sm"><input type="checkbox" className="size-4" {...register(f.name)} />{f.label}</label>
        ) : "options" in f ? (
          <div key={f.name} className="field-group space-y-1.5"><Label htmlFor={f.name}>{f.label}</Label>
            <NativeSelect id={f.name} {...register(f.name)}><option value="">{f.optional ? tr("بدون") : tr("اختر")}</option>{f.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</NativeSelect></div>
        ) : (
          <div key={f.name} className="field-group space-y-1.5"><Label htmlFor={f.name}>{f.label}</Label>
            <Input id={f.name} type={f.type === "number" ? "text" : (f.type ?? "text")} inputMode={f.type === "number" ? "decimal" : undefined}
              dir={f.ltr || f.type ? "ltr" : undefined} {...register(f.name)} /></div>
        ),
      )}
      <div className="md:col-span-full"><Button type="submit" loading={pending}>{submitLabel}</Button></div>
    </form>
  );
}
