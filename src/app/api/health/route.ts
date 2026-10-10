import { NextResponse } from "next/server";
import { resolveAssistant } from "@/lib/assistant/provider";
import { secretsHealth } from "@/lib/server-secrets";

export const dynamic = "force-dynamic";

/** فحص تشغيل عام بلا بيانات حساسة: الخادم يعمل، ومخزن الأسرار يقرأ، والمساعد مفعّل ومن أين مفتاحه */
export async function GET() {
  const [secrets, ai] = await Promise.all([secretsHealth(), resolveAssistant().catch(() => null)]);
  return NextResponse.json({ ok: true, secrets, assistant: ai?.source ?? null }, { headers: { "Cache-Control": "no-store" } });
}
