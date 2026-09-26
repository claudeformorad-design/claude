"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/link";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import type { ActionResult } from "@/services/errors";
import { deleteDraftAction, postJournalEntryAction, reverseJournalEntryAction } from "../actions";
import { actionErrorText } from "@/lib/action-error";

export function EntryActions({
  t,
  entryId,
  status,
  canCreate,
  canPost,
  canReverse,
  today,
}: {
  t: Pick<Dictionary, "journal" | "common" | "errors">;
  entryId: string;
  status: "draft" | "posted" | "reversed" | "reversal";
  canCreate: boolean;
  canPost: boolean;
  canReverse: boolean;
  today: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reversalDate, setReversalDate] = useState(today);

  const run = <T,>(fn: () => Promise<ActionResult<T>>, onOk: (data: T) => void) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) onOk(result.data);
      else setError(actionErrorText(t.errors, result));
    });
  };

  return (
    <div className="space-y-3">
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="flex flex-wrap items-center gap-2">
        {status === "draft" && canCreate && (
          <Button asChild variant="outline">
            <Link href={`/journal/${entryId}/edit`}>{t.common.edit}</Link>
          </Button>
        )}
        {status === "draft" && canPost && (
          <Button disabled={pending} onClick={() => run(() => postJournalEntryAction(entryId), () => router.refresh())}>
            {t.journal.post}
          </Button>
        )}
        {status === "draft" && canCreate && (
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() => {
              if (confirm(t.journal.deleteDraft + "?")) run(() => deleteDraftAction(entryId), () => router.push("/journal"));
            }}
          >
            {t.journal.deleteDraft}
          </Button>
        )}
        {status === "posted" && canReverse && (
          <>
            <Input
              type="date"
              dir="ltr"
              className="w-40"
              value={reversalDate}
              onChange={(e) => setReversalDate(e.target.value)}
              aria-label={t.journal.reversalDate}
            />
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => {
                if (confirm(t.journal.reverseConfirm))
                  run(() => reverseJournalEntryAction(entryId, reversalDate), (id) => router.push(`/journal/${id}`));
              }}
            >
              {t.journal.reverse}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
