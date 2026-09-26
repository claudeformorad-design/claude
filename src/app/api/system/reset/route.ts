import { NextRequest, NextResponse } from "next/server";
import { resetMockStore } from "@/lib/supabase/mock-data";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({ clean: true }));
    const clean = body.clean !== false;
    resetMockStore(clean);
    return NextResponse.json({
      success: true,
      message: clean
        ? "تم إعادة تهيئة النظام كبدء جديد ونظيف بنجاح."
        : "تم تحميل البيانات التجريبية بنجاح.",
    });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
