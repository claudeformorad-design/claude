"use server";

import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { isIsoDate } from "@/lib/accounting/fiscal";
import {
  journalEntryDraftSchema,
  journalEntryFormSchema,
  type JournalEntryFormValues,
} from "@/lib/validation/journal-entry";
import {
  deleteDraftJournalEntry,
  postJournalEntry,
  reverseJournalEntry,
  saveJournalEntry,
} from "@/services/journal.service";
import { type ActionResult, toActionResult } from "@/services/errors";

export async function saveJournalEntryAction(
  values: JournalEntryFormValues,
  options: { entryId?: string; post: boolean },
): Promise<ActionResult<string>> {
  const ctx = await requireAppContext(PERMISSIONS.journalCreate);
  // إعادة التحقق في الخادم (لا نثق بالعميل)، ثم قاعدة البيانات تتحقق مرة ثالثة عند الترحيل
  const schema = options.post ? journalEntryFormSchema : journalEntryDraftSchema;
  const parsed = schema.safeParse(values);
  if (!parsed.success) return { ok: false, error: "validation" };

  const result = await toActionResult(() => saveJournalEntry(ctx.supabase, ctx.hotel.id, parsed.data, options));
  if (result.ok) revalidatePath("/journal");
  return result;
}

export async function postJournalEntryAction(entryId: string): Promise<ActionResult<string>> {
  const ctx = await requireAppContext(PERMISSIONS.journalPost);
  const result = await toActionResult(() => postJournalEntry(ctx.supabase, entryId));
  if (result.ok) revalidatePath("/journal");
  return result;
}

export async function reverseJournalEntryAction(entryId: string, reversalDate: string): Promise<ActionResult<string>> {
  const ctx = await requireAppContext(PERMISSIONS.journalReverse);
  const date = isIsoDate(reversalDate) ? reversalDate : null;
  const result = await toActionResult(() => reverseJournalEntry(ctx.supabase, entryId, date));
  if (result.ok) revalidatePath("/journal");
  return result;
}

export async function deleteDraftAction(entryId: string): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.journalCreate);
  const result = await toActionResult(async () => {
    await deleteDraftJournalEntry(ctx.supabase, ctx.hotel.id, entryId);
    return undefined;
  });
  if (result.ok) revalidatePath("/journal");
  return result;
}
