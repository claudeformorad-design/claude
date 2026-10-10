import { NextResponse } from "next/server";
import { getAppContext, type AppContext } from "@/lib/auth/context";
import { ATTACHMENT_ENTITIES, ATTACHMENT_MAX_BYTES, ATTACHMENT_TYPES, type AttachmentEntity } from "@/services/attachments.service";
import { raise, toActionResult } from "@/services/errors";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** رفع مرفق لمستند (قيد، سند، فاتورة مورد، فاتورة عميل). قاعدة البيانات تتحقق من الصلاحية والمستند والحجم */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.headers.get("host")) return NextResponse.json({ ok: false, error: "permission_denied" }, { status: 403 });
  const ctx = await getAppContext();
  if (!ctx.user || !ctx.hotel) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const app = ctx as AppContext;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const entityType = String(form?.get("entityType") ?? "");
  const entityId = String(form?.get("entityId") ?? "");
  if (!(file instanceof File) || !ATTACHMENT_ENTITIES.includes(entityType as AttachmentEntity) || !UUID.test(entityId)) {
    return NextResponse.json({ ok: false, error: "validation" }, { status: 400 });
  }
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mime = ATTACHMENT_TYPES[ext];
  if (!mime) return NextResponse.json({ ok: false, error: "validation", message: "unsupported_type" }, { status: 400 });
  if (file.size === 0 || file.size > ATTACHMENT_MAX_BYTES) return NextResponse.json({ ok: false, error: "validation", message: "too_large" }, { status: 400 });
  const content = Buffer.from(await file.arrayBuffer()).toString("base64");
  const r = await toActionResult(async () => {
    const { data, error } = await app.supabase.rpc("add_attachment", {
      p_hotel_id: app.hotel.id, p_entity_type: entityType, p_entity_id: entityId, p_file_name: file.name.slice(0, 200), p_mime_type: mime, p_content_base64: content,
    });
    raise(error);
    return data!;
  });
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
