"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAppContext, type AppContext } from "@/lib/auth/context";
import { PERMISSIONS, type Permission } from "@/lib/auth/permissions";
import { formatMoney } from "@/lib/accounting/money";
import type { Json } from "@/lib/supabase/database.types";
import { folioActionSchema, type FolioAction } from "@/lib/validation/revenue";
import { runFolioAction } from "@/services/folio.service";
import { voidVoucher } from "@/services/vouchers.service";
import { type ActionResult, raise, toActionResult } from "@/services/errors";

const fail = { ok: false as const, error: "validation" as const };

/** الصلاحية التي يحتاجها من ينفّذ كل عملية فوليو */
const FOLIO_PERMISSION: Record<FolioAction["kind"], Permission> = {
  charge: PERMISSIONS.folioManage, payment: PERMISSIONS.folioManage, deposit: PERMISSIONS.folioManage, refund: PERMISSIONS.folioManage,
  depositRefund: PERMISSIONS.folioManage, transfer: PERMISSIONS.folioManage, allowance: PERMISSIONS.folioAllowance, void: PERMISSIONS.folioVoid,
};
const FOLIO_LABEL: Record<FolioAction["kind"], string> = {
  charge: "رسم", payment: "دفعة", deposit: "عربون", refund: "استرداد", depositRefund: "رد عربون", transfer: "تحويل رصيد",
  allowance: "خصم", void: "إلغاء حركة",
};

const requestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("folio_action"), payload: z.object({ folio_id: z.uuid(), action: folioActionSchema }), note: z.string().max(500).optional() }),
  z.object({ kind: z.literal("reservation_cancel"), payload: z.object({ reservation_id: z.uuid(), reason: z.string().trim().min(1).max(500) }), note: z.string().max(500).optional() }),
  z.object({ kind: z.literal("voucher_void"), payload: z.object({ voucher_id: z.uuid(), reason: z.string().trim().min(1).max(500) }), note: z.string().max(500).optional() }),
]);
type Request = z.infer<typeof requestSchema>;
const REQUESTER_PERMISSION: Record<Request["kind"], Permission> = {
  folio_action: PERMISSIONS.folioManage, reservation_cancel: PERMISSIONS.pmsManage, voucher_void: PERMISSIONS.paymentsView,
};

/** وصف الطلب يُبنى في الخادم من البيانات الفعلية، لا مما يرسله المتصفح */
async function describe(ctx: AppContext, r: Request): Promise<{ summary: string; amount: string | null }> {
  const money = (v: string) => `${formatMoney(v, { locale: "ar" })} ${ctx.hotel.base_currency}`;
  if (r.kind === "folio_action") {
    const { data, error } = await ctx.supabase.from("guest_folios").select("folio_number, guest_name").eq("id", r.payload.folio_id).maybeSingle();
    raise(error);
    if (!data) throw Object.assign(new Error("Folio not found or inactive"), {});
    const a = r.payload.action;
    const amount = "amount" in a ? String(a.amount) : "unit_price" in a ? String(a.unit_price) : null;
    const reason = "reason" in a && a.reason ? `، السبب: ${a.reason}` : "";
    return { summary: `${FOLIO_LABEL[a.kind]}${amount ? ` ${money(amount)}` : ""} على الفوليو ${data.folio_number} للنزيل ${data.guest_name}${reason}`, amount };
  }
  if (r.kind === "reservation_cancel") {
    const { data, error } = await ctx.supabase.from("reservations").select("confirmation_number, total_amount::text").eq("id", r.payload.reservation_id).maybeSingle();
    raise(error);
    if (!data) throw new Error("Reservation not found");
    const row = data as unknown as { confirmation_number: string; total_amount: string };
    return { summary: `إلغاء الحجز ${row.confirmation_number}، السبب: ${r.payload.reason}`, amount: row.total_amount };
  }
  const { data, error } = await ctx.supabase.from("payments").select("voucher_number, amount::text").eq("id", r.payload.voucher_id).maybeSingle();
  raise(error);
  if (!data) throw new Error("Voucher not found");
  const row = data as unknown as { voucher_number: string; amount: string };
  return { summary: `إلغاء السند ${row.voucher_number} بمبلغ ${money(row.amount)}، السبب: ${r.payload.reason}`, amount: row.amount };
}

/** الموظف يرسل طلب موافقة لعملية تتجاوز صلاحيته أو حده */
export async function requestApprovalAction(input: unknown): Promise<ActionResult<string>> {
  const ctx = await requireAppContext();
  const p = requestSchema.safeParse(input);
  if (!p.success) return fail;
  // يطلب الموافقة من يعمل على هذا النوع من العمليات فقط
  if (!ctx.can(REQUESTER_PERMISSION[p.data.kind])) return { ok: false, error: "permission_denied" };
  const r = await toActionResult(async () => {
    const d = await describe(ctx, p.data);
    const { data, error } = await ctx.supabase.from("approval_requests").insert({
      hotel_id: ctx.hotel.id, kind: p.data.kind, payload: p.data.payload as unknown as Json, summary: d.summary,
      amount: d.amount, note: p.data.note?.trim() || null, requested_by: ctx.user.id,
    }).select("id").single();
    raise(error);
    return data!.id as string;
  });
  if (r.ok) revalidatePath("/approvals");
  return r;
}

export async function requestReservationCancelAction(reservationId: string, reason: string): Promise<ActionResult<string>> {
  return requestApprovalAction({ kind: "reservation_cancel", payload: { reservation_id: reservationId, reason } });
}

export async function requestVoucherVoidAction(voucherId: string, reason: string): Promise<ActionResult<string>> {
  return requestApprovalAction({ kind: "voucher_void", payload: { voucher_id: voucherId, reason } });
}

/** تنفيذ العملية المطلوبة بهوية المدير الذي وافق، فتطبَّق صلاحياته وحدوده هو */
async function execute(ctx: AppContext, kind: string, payload: unknown): Promise<string> {
  const r = requestSchema.parse({ kind, payload });
  if (r.kind === "folio_action") {
    if (!ctx.can(FOLIO_PERMISSION[r.payload.action.kind])) throw new Error("Permission denied: approver");
    await runFolioAction(ctx.supabase, r.payload.folio_id, r.payload.action);
    revalidatePath(`/folios/${r.payload.folio_id}`);
    return "نُفّذت العملية على الفوليو";
  }
  if (r.kind === "reservation_cancel") {
    if (!ctx.can(PERMISSIONS.pmsCancel)) throw new Error("Permission denied: approver");
    const { error } = await ctx.supabase.rpc("cancel_reservation", { p_reservation_id: r.payload.reservation_id, p_reason: r.payload.reason });
    raise(error);
    revalidatePath(`/reservations/${r.payload.reservation_id}`);
    return "أُلغي الحجز";
  }
  if (!ctx.can(PERMISSIONS.paymentsVoid)) throw new Error("Permission denied: approver");
  await voidVoucher(ctx.supabase, r.payload.voucher_id, r.payload.reason);
  revalidatePath(`/vouchers/${r.payload.voucher_id}`);
  return "أُلغي السند";
}

export async function decideApprovalAction(id: string, approve: boolean, note?: string): Promise<ActionResult<string>> {
  const ctx = await requireAppContext(PERMISSIONS.approvalsDecide);
  if (!z.uuid().safeParse(id).success) return fail;
  const r = await toActionResult(async () => {
    const { data: req, error } = await ctx.supabase.from("approval_requests").select("kind, payload").eq("id", id).maybeSingle();
    raise(error);
    if (!req) throw new Error("Approval request not found");
    raise((await ctx.supabase.rpc("decide_approval", { p_request_id: id, p_approve: approve, p_note: note?.trim() || null })).error);
    if (!approve) return "رُفض الطلب";
    // التنفيذ بعد الموافقة؛ فشله يُسجَّل على الطلب ولا يضيع
    const outcome = await toActionResult(() => execute(ctx, req.kind, req.payload));
    const ok = outcome.ok;
    raise((await ctx.supabase.rpc("finish_approval", {
      p_request_id: id, p_ok: ok, p_result: ok ? outcome.data : null, p_error: ok ? null : (outcome.message ?? outcome.details ?? outcome.error),
    })).error);
    if (!ok) throw Object.assign(new Error(outcome.details ?? "failed"), {});
    return outcome.data;
  });
  revalidatePath("/approvals");
  return r;
}

export async function cancelApprovalAction(id: string): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext();
  if (!z.uuid().safeParse(id).success) return fail;
  const r = await toActionResult(async () => {
    raise((await ctx.supabase.rpc("cancel_approval", { p_request_id: id })).error);
    return undefined;
  });
  revalidatePath("/approvals");
  return r;
}
