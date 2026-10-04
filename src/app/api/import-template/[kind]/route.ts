import { NextResponse } from "next/server";
import { getAppContext, type AppContext } from "@/lib/auth/context";
import { importTemplate } from "@/lib/import/template";
import { importDefinition } from "@/services/import.service";

/** تنزيل قالب Excel لنوع الاستيراد */
export async function GET(_request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const def = importDefinition(kind);
  if (!def) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const ctx = await getAppContext();
  if (!ctx.user || !ctx.hotel) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(ctx as AppContext).can(def.permission)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const buffer = await importTemplate(def.title, def.columns);
  const name = `قالب استيراد ${def.title}.xlsx`;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="import-${kind}.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}
