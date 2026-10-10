import { NextResponse } from "next/server";
import { getAppContext, type AppContext } from "@/lib/auth/context";

/** تنزيل مرفق: قاعدة البيانات لا تعيده إلا لمن يملك عرض المستند المرفق به */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const ctx = await getAppContext();
  if (!ctx.user || !ctx.hotel) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const app = ctx as AppContext;
  const { data, error } = await app.supabase.rpc("attachment_content", { p_id: id });
  const row = data?.[0];
  if (error || !row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const inline = row.mime_type === "application/pdf" || row.mime_type.startsWith("image/");
  return new NextResponse(Buffer.from(row.content_base64, "base64"), {
    headers: {
      "Content-Type": row.mime_type,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
