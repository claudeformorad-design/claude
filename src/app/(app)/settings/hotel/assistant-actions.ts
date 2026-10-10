"use server";
import { tr } from "@/i18n/tr";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAppContext } from "@/lib/auth/context";
import { isSystemAdmin } from "@/lib/auth/owner";
import {
  buildConfig, classifyProviderError, maskKey, pingProvider, problemText, providerFromKey, resolveAssistant, saveStoredAssistant,
} from "@/lib/assistant/provider";
import type { ActionResult } from "@/services/errors";

const denied = { ok: false as const, error: "permission_denied" as const };
const fail = (message: string) => ({ ok: false as const, error: "unknown" as const, message });

const input = z.object({
  key: z.string().trim().min(20).max(300).regex(/^\S+$/),
  model: z.string().trim().max(120).regex(/^[\w./:~-]*$/).optional(),
});

/** يحفظ مفتاح المساعد بعد تجربته فعليًا مع المزود، فلا يُحفظ مفتاح لا يعمل */
export async function saveAssistantKeyAction(raw: unknown): Promise<ActionResult<{ masked: string; warning?: string }>> {
  const ctx = await requireAppContext();
  if (!(await isSystemAdmin(ctx))) return denied;
  const p = input.safeParse(raw);
  if (!p.success) return fail(tr("الصق المفتاح كما هو من موقع المزود، بلا مسافات."));
  const provider = providerFromKey(p.data.key);
  if (!provider) return fail(tr("هذا لا يشبه مفتاح Google Gemini (يبدأ بـ AIza) ولا مفتاح OpenRouter (يبدأ بـ sk-or-)."));
  const cfg = buildConfig(provider, p.data.key, p.data.model, process.env.AI_BASE_URL);
  let warning: string | undefined;
  try {
    await pingProvider(cfg);
  } catch (e) {
    const problem = classifyProviderError(e);
    // المفتاح صحيح لكن الحد أو الرصيد مؤقت: يُحفظ مع تنبيه
    if (problem === "rate_limit" || problem === "credits") warning = problemText(problem);
    else return fail(problemText(problem));
  }
  try {
    await saveStoredAssistant({ provider, key: p.data.key, model: p.data.model || null });
  } catch (e) {
    console.error(e);
    return fail(tr("تعذّر حفظ المفتاح على الخادم، حاول مرة أخرى."));
  }
  revalidatePath("/", "layout");
  return { ok: true, data: { masked: maskKey(p.data.key), ...(warning ? { warning } : {}) } };
}

/** تجربة المفتاح الحالي (من البيئة أو الإعدادات) برسالة واضحة عند المشكلة */
export async function testAssistantAction(): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext();
  if (!(await isSystemAdmin(ctx))) return denied;
  const r = await resolveAssistant();
  if (!r) return fail(tr("لا يوجد مفتاح بعد. أضف المفتاح أولًا."));
  try {
    await pingProvider(r.config);
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(problemText(classifyProviderError(e)));
  }
}

export async function removeAssistantKeyAction(): Promise<ActionResult<undefined>> {
  const ctx = await requireAppContext();
  if (!(await isSystemAdmin(ctx))) return denied;
  try {
    await saveStoredAssistant(null);
  } catch (e) {
    console.error(e);
    return fail(tr("تعذّر حذف المفتاح من الخادم، حاول مرة أخرى."));
  }
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}
