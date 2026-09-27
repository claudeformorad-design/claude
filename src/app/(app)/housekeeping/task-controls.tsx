"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Play, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { actionErrorText } from "@/lib/action-error";
import { generateHousekeepingAction, updateHousekeepingTaskAction } from "../_ops/actions";

/** إسناد المهمة لعامل وتغيير حالتها (بدء، إنجاز، إلغاء) */
export function TaskControls({ taskId, status, assignee, errors }: { taskId: string; status: string; assignee: string | null; errors: Record<string, string> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(assignee ?? "");
  const act = (input: { status?: string; assignee?: string }, done: string) => start(async () => {
    const r = await updateHousekeepingTaskAction(taskId, input);
    if (r.ok) { toast(done); router.refresh(); } else toast(actionErrorText(errors, r), "error");
  });
  if (status === "done" || status === "cancelled") return null;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Input aria-label="العامل" className="h-9 w-32" placeholder="العامل" value={name} onChange={(e) => setName(e.target.value)}
        onBlur={() => { if (name.trim() !== (assignee ?? "")) act({ assignee: name }, "تم الإسناد"); }} />
      {status === "pending" && <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => act({ status: "in_progress", assignee: name }, "بدأت المهمة")}><Play className="size-3.5" />بدء</Button>}
      <Button type="button" size="sm" disabled={pending} onClick={() => act({ status: "done", assignee: name }, "أُنجزت المهمة")}><Check className="size-3.5" />تم</Button>
      <Button type="button" size="sm" variant="ghost" aria-label="إلغاء المهمة" disabled={pending} onClick={() => act({ status: "cancelled" }, "أُلغيت المهمة")}><X className="size-3.5" /></Button>
    </div>
  );
}

export function GenerateButton({ date, errors }: { date: string; errors: Record<string, string> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button type="button" loading={pending} onClick={() => start(async () => {
      const r = await generateHousekeepingAction(date);
      if (r.ok) { toast(r.data ? `أُنشئت ${r.data} مهمة` : "لا مهام جديدة"); router.refresh(); } else toast(actionErrorText(errors, r), "error");
    })}>
      <Sparkles />توليد مهام اليوم
    </Button>
  );
}
