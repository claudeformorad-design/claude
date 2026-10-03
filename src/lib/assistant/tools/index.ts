import "server-only";
import type { AppContext } from "@/lib/auth/context";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import type { ToolSpec } from "../provider";
import { type ToolArgs, type ToolEnv, type ToolModule, clip, today } from "./shared";
import { core } from "./core";
import { finance } from "./finance";
import { hr } from "./hr";
import { hotel } from "./hotel";

/**
 * أدوات المساعد: قراءة فقط، وكلها تعمل بجلسة المستخدم نفسه فتطبق صلاحياته وحماية قاعدة البيانات (RLS).
 * لا توجد أداة تنشئ أو تعدّل أو تحذف شيئًا.
 */
const MODULES: ToolModule[] = [core, finance, hr, hotel];

export const TOOL_SPECS: ToolSpec[] = MODULES.flatMap((m) => m.specs);
const RUNNERS = Object.assign({}, ...MODULES.map((m) => m.run)) as ToolModule["run"];

async function snapshot(env: ToolEnv) {
  const parts = await Promise.all(MODULES.map((m) => (m.snapshot ? m.snapshot(env).catch(() => ({})) : {})));
  return { hotel: env.ctx.hotel.name_ar, today: today(env), base_currency: env.ctx.hotel.base_currency, ...Object.assign({}, ...parts) };
}

export async function runTool(ctx: AppContext, t: Dictionary, locale: string, name: string, rawArgs: string): Promise<string> {
  let args: ToolArgs;
  try {
    const parsed: unknown = rawArgs ? JSON.parse(rawArgs) : {};
    args = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as ToolArgs) : {};
  } catch { return clip({ error: "معطيات الأداة غير صالحة" }); }
  const env: ToolEnv = { ctx, t, locale };
  try {
    if (name === "hotel_snapshot") return clip(await snapshot(env));
    const run = RUNNERS[name];
    return clip(run ? await run(env, args) : { error: "أداة غير معروفة" });
  } catch (e) {
    return clip({ error: e instanceof Error ? e.message : "خطأ غير متوقع" });
  }
}
