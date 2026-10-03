"use server";

import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS, type Permission } from "@/lib/auth/permissions";
import { folioActionSchema, openFolioSchema, type OpenFolioInput } from "@/lib/validation/revenue";
import { cancelFolio, checkoutFolio, openFolio, runFolioAction } from "@/services/folio.service";
import { type ActionResult, toActionResult } from "@/services/errors";

export async function openFolioAction(input: OpenFolioInput): Promise<ActionResult<string>> {
  const ctx = await requireAppContext(PERMISSIONS.folioManage);
  if (!openFolioSchema.safeParse(input).success) return { ok: false, error: "validation" };
  const r = await toActionResult(() => openFolio(ctx.supabase, ctx.hotel.id, input));
  if (r.ok) revalidatePath("/folios");
  return r;
}

const ACTION_PERMISSION: Record<string, Permission> = {
  charge: PERMISSIONS.folioManage,
  payment: PERMISSIONS.folioManage,
  deposit: PERMISSIONS.folioManage,
  refund: PERMISSIONS.folioManage,
  depositRefund: PERMISSIONS.folioManage,
  transfer: PERMISSIONS.folioManage,
  allowance: PERMISSIONS.folioAllowance,
  void: PERMISSIONS.folioVoid,
};

export async function folioAction(folioId: string, input: unknown): Promise<ActionResult<undefined>> {
  const parsed = folioActionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const ctx = await requireAppContext(ACTION_PERMISSION[parsed.data.kind]);
  const r = await toActionResult(async () => {
    await runFolioAction(ctx.supabase, folioId, parsed.data);
    return undefined;
  });
  if (r.ok) revalidatePath(`/folios/${folioId}`);
  return r;
}

export async function checkoutAction(folioId: string): Promise<ActionResult<string>> {
  const ctx = await requireAppContext(PERMISSIONS.folioCheckout);
  const r = await toActionResult(() => checkoutFolio(ctx.supabase, folioId));
  if (r.ok) {
    revalidatePath(`/folios/${folioId}`);
    revalidatePath("/invoices");
  }
  return r;
}

export async function cancelFolioAction(folioId: string): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext(PERMISSIONS.folioManage);
  const r = await toActionResult(async () => {
    await cancelFolio(ctx.supabase, folioId);
    return undefined;
  });
  if (r.ok) revalidatePath("/folios");
  return r;
}
