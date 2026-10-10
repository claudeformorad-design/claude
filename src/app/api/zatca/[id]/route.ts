import { NextResponse } from "next/server";
import { getAppContext, type AppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { documentXml } from "@/services/zatca.service";

/** ملف UBL للفاتورة أو الإشعار الدائن (بمعرّف المستند) لمن يملك عرض الفواتير */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const ctx = await getAppContext();
  if (!ctx.user || !ctx.hotel) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const app = ctx as AppContext;
  if (!app.can(PERMISSIONS.invoicesView)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const doc = await documentXml(app.supabase, app.hotel, id);
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return new NextResponse(doc.xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${doc.number}.xml"`,
    },
  });
}
