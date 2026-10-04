"use client";
import { tr } from "@/i18n/tr";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ListChecks, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { actionErrorText, callAction } from "@/lib/action-error";
import { generateHousekeepingAction, updateHousekeepingTaskAction } from "../_ops/actions";

/** إسناد المهمة لعامل وتغيير حالتها (بدء، إنجاز، إلغاء) */
export function TaskControls({ taskId, status, assignee, errors }: { taskId: string; status: string; assignee: string | null; errors: Record<string, string> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(assignee ?? "");
  const act = (input: { status?: string; assignee?: string }, done: string) => start(async () => {
    const r = await callAction(updateHousekeepingTaskAction(taskId, input));
    if (r.ok) { toast(done); router.refresh(); } else toast(actionErrorText(errors, r), "error");
  });
  if (status === "done" || status === "cancelled") return null;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Input aria-label={tr("العامل")} className="h-9 w-32" placeholder={tr("العامل")} value={name} onChange={(e) => setName(e.target.value)}
        onBlur={() => { if (name.trim() !== (assignee ?? "")) act({ assignee: name }, tr("تم الإسناد")); }} />
      {status === "pending" && <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => act({ status: "in_progress", assignee: name }, tr("بدأت المهمة"))}><Play className="size-3.5" />{tr("بدء")}</Button>}
      <Button type="button" size="sm" disabled={pending} onClick={() => act({ status: "done", assignee: name }, tr("أُنجزت المهمة"))}><Check className="size-3.5" />{tr("تم")}</Button>
      <Button type="button" size="sm" variant="ghost" aria-label={tr("إلغاء المهمة")} disabled={pending} onClick={() => act({ status: "cancelled" }, tr("أُلغيت المهمة"))}><X className="size-3.5" /></Button>
    </div>
  );
}

export function GenerateButton({ date, errors }: { date: string; errors: Record<string, string> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button type="button" loading={pending} onClick={() => start(async () => {
      const r = await callAction(generateHousekeepingAction(date));
      if (r.ok) { toast(r.data ? tr("أُنشئت {0} مهمة", r.data) : tr("لا مهام جديدة")); router.refresh(); } else toast(actionErrorText(errors, r), "error");
    })}>
      <ListChecks />{tr("توليد مهام اليوم")}</Button>
  );
}
