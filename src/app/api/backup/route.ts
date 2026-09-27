import { NextResponse } from "next/server";
import { getAppContext, type AppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { exportLocalBackup } from "@/lib/supabase/local-db";

/** تنزيل نسخة احتياطية كاملة من القاعدة (وضع التشغيل المحلي فقط) */
export async function GET() {
  if (isSupabaseConfigured()) return NextResponse.json({ error: "managed_by_supabase" }, { status: 400 });
  const ctx = await getAppContext();
  if (!ctx.user || !ctx.hotel) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const app = ctx as AppContext;
  if (!app.can(PERMISSIONS.hotelManage)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const blob = await exportLocalBackup();
  const name = `hotel-backup-${todayInTimeZone(app.hotel.timezone)}.tar.gz`;
  return new NextResponse(blob, {
    headers: { "Content-Type": "application/gzip", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
  });
}
