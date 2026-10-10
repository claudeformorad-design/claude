"use server";

import { z } from "zod";
import { describeDatabaseError } from "@/lib/accounting/errors";
import { anonRpc } from "@/lib/supabase/public-rpc";

const rating = z.number().int().min(1).max(5);

/** إرسال تقييم النزيل برمز الاستبيان، بلا تسجيل دخول */
export async function submitSurveyAction(token: string, input: unknown): Promise<{ ok: true } | { ok: false; message: string | null }> {
  const p = z.object({
    overall: rating, cleanliness: rating.nullable(), staff: rating.nullable(), comfort: rating.nullable(), value: rating.nullable(), food: rating.nullable(),
    recommend: z.boolean().nullable(), comment: z.string().max(2000),
  }).safeParse(input);
  if (!p.success || !/^[0-9a-f]{64}$/.test(token)) return { ok: false, message: null };
  const { error } = await anonRpc("submit_guest_survey", {
    p_token: token, p_overall: p.data.overall, p_cleanliness: p.data.cleanliness, p_staff: p.data.staff, p_comfort: p.data.comfort,
    p_value: p.data.value, p_food: p.data.food, p_recommend: p.data.recommend, p_comment: p.data.comment.trim() || null, p_channel: "kiosk",
  });
  if (error) return { ok: false, message: describeDatabaseError(error.message) };
  return { ok: true };
}
