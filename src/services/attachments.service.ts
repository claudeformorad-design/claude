import "server-only";
import type { SupabaseServerClient } from "@/lib/supabase/server";
import { raise } from "./errors";

export type AttachmentEntity = "journal_entry" | "payment" | "vendor_bill" | "invoice";
export const ATTACHMENT_ENTITIES: readonly AttachmentEntity[] = ["journal_entry", "payment", "vendor_bill", "invoice"];
export const ATTACHMENT_MAX_BYTES = 3 * 1024 * 1024;
export const ATTACHMENT_TYPES: Record<string, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export interface AttachmentRow { id: string; file_name: string; mime_type: string; size_bytes: number; created_at: string }

/** مرفقات مستند (قاعدة البيانات تُظهرها لمن يملك عرض المستند فقط) */
export async function listAttachments(supabase: SupabaseServerClient, hotelId: string, entity: AttachmentEntity, entityId: string): Promise<AttachmentRow[]> {
  const { data, error } = await supabase.from("attachments").select("id, file_name, mime_type, size_bytes, created_at")
    .eq("hotel_id", hotelId).eq("entity_type", entity).eq("entity_id", entityId).order("created_at");
  raise(error);
  return data ?? [];
}
