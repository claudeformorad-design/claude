"use server";

import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { type ToggleResult, toggleFeature } from "@/lib/features/server";
import { type ActionResult, toActionResult } from "@/services/errors";

/** تشغيل أو إطفاء قسم أو جزء أو خانة أو زر. confirm: المستخدم قرأ التحذير ووافق */
export async function toggleFeatureAction(key: string, on: boolean, confirm = false): Promise<ActionResult<ToggleResult>> {
  const ctx = await requireAppContext(PERMISSIONS.hotelManage);
  if (typeof key !== "string" || key.length > 120 || typeof on !== "boolean") return { ok: false, error: "validation" };
  const r = await toActionResult(() => toggleFeature(ctx, key, on, confirm === true));
  if (r.ok && r.data.ok) revalidatePath("/", "layout");
  return r;
}
