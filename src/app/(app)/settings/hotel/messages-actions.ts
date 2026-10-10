"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { TEMPLATE_KEYS } from "@/lib/whatsapp";
import { type ActionResult, invalid, raise, toActionResult } from "@/services/errors";

/** حفظ نص رسالة واتساب للفندق؛ النص الفارغ يعيدها لنصها الافتراضي */
export async function saveMessageTemplateAction(key: string, body: string): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.hotelManage);
  const p = z.object({ key: z.enum(TEMPLATE_KEYS), body: z.string().max(2000) }).safeParse({ key, body });
  if (!p.success) return invalid(p.error);
  const r = await toActionResult(async () => {
    const { error } = await ctx.supabase.rpc("save_message_template", { p_hotel_id: ctx.hotel.id, p_key: p.data.key, p_body: p.data.body });
    raise(error);
    return undefined;
  });
  if (r.ok) revalidatePath("/settings/hotel");
  return r;
}
