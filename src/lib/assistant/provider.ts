import "server-only";
import { tr } from "@/i18n/tr";
import { readSecret, writeSecret } from "@/lib/server-secrets";

/**
 * الاتصال بنموذج المساعد عبر واجهة متوافقة مع OpenAI (Chat Completions):
 * Google Gemini مباشرة، أو OpenRouter. المفتاح يبقى على الخادم ولا يصل للمتصفح أبدًا.
 *
 * مصدر المفتاح بالترتيب:
 * 1) متغيرات بيئة الخادم: GEMINI_API_KEY أو OPENROUTER_API_KEY (ومعها اختياريًا AI_PROVIDER و AI_MODEL و AI_BASE_URL)
 * 2) المفتاح الذي يضيفه صاحب النظام من الإعدادات، ويُحفظ في مخزن أسرار الخادم (server-secrets)
 */
export type Provider = "gemini" | "openrouter";
export type AssistantConfig = { provider: Provider; url: string; key: string; model: string };
export type ConfigSource = "env" | "settings";

const DEFAULT_MODEL: Record<Provider, string> = { gemini: "gemini-flash-latest", openrouter: "google/gemini-3.8-flash" };
const BASE_URL: Record<Provider, string> = { gemini: "https://generativelanguage.googleapis.com/v1beta/openai", openrouter: "https://openrouter.ai/api/v1" };

export function buildConfig(provider: Provider, key: string, model?: string | null, base?: string | null): AssistantConfig {
  const root = base?.trim().replace(/\/+$/, "") || BASE_URL[provider];
  return { provider, url: `${root}/chat/completions`, key, model: model?.trim() || DEFAULT_MODEL[provider] };
}

/** المفتاح من متغيرات بيئة الخادم */
export function assistantConfig(): AssistantConfig | null {
  const gemini = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
  const openrouter = process.env.OPENROUTER_API_KEY?.trim();
  const choice = process.env.AI_PROVIDER === "openrouter" ? "openrouter" : process.env.AI_PROVIDER === "gemini" ? "gemini" : gemini ? "gemini" : "openrouter";
  const model = process.env.AI_MODEL;
  const base = process.env.AI_BASE_URL;
  if (choice === "gemini" && gemini) return buildConfig("gemini", gemini, model, base);
  if (choice === "openrouter" && openrouter) return buildConfig("openrouter", openrouter, model, base);
  return null;
}

/** نوع المفتاح من بدايته: مفاتيح Google تبدأ بـ AIza، ومفاتيح OpenRouter بـ sk-or- */
export function providerFromKey(key: string): Provider | null {
  const k = key.trim();
  if (/^AIza[0-9A-Za-z_-]{20,}$/.test(k)) return "gemini";
  if (/^sk-or-[0-9A-Za-z_-]{10,}$/.test(k)) return "openrouter";
  return null;
}

type Stored = { provider: Provider; key: string; model?: string | null };
const SECRET = "assistant";
const TTL = 30_000;
let cache: { at: number; value: Stored | null } | null = null;

async function readStored(): Promise<Stored | null> {
  if (cache && Date.now() - cache.at < TTL) return cache.value;
  let value: Stored | null = null;
  try {
    const raw = await readSecret(SECRET);
    const p = raw ? (JSON.parse(raw) as Partial<Stored>) : null;
    if (p && (p.provider === "gemini" || p.provider === "openrouter") && typeof p.key === "string" && p.key) value = { provider: p.provider, key: p.key, model: p.model ?? null };
  } catch { value = null; }
  cache = { at: Date.now(), value };
  return value;
}

/** إعداد المساعد الفعلي ومصدره: البيئة أولًا ثم ما حفظه صاحب النظام */
export async function resolveAssistant(): Promise<{ config: AssistantConfig; source: ConfigSource } | null> {
  const env = assistantConfig();
  if (env) return { config: env, source: "env" };
  const s = await readStored();
  return s ? { config: buildConfig(s.provider, s.key, s.model, process.env.AI_BASE_URL), source: "settings" } : null;
}

export async function getAssistantConfig(): Promise<AssistantConfig | null> {
  return (await resolveAssistant())?.config ?? null;
}

export async function saveStoredAssistant(value: Stored | null): Promise<void> {
  await writeSecret(SECRET, value ? JSON.stringify({ provider: value.provider, key: value.key.trim(), model: value.model?.trim() || null }) : null);
  cache = { at: Date.now(), value };
}

/** آخر أربعة أحرف فقط للعرض، والمفتاح نفسه لا يغادر الخادم */
export const maskKey = (key: string) => `••••${key.trim().slice(-4)}`;

/** extra_content: توقيع تفكير Gemini المرافق لطلب الأداة، ويُعاد كما هو في الجولة التالية */
export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string }; extra_content?: unknown };
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[]; reasoning_details?: unknown[] }
  | { role: "tool"; tool_call_id: string; content: string };
export type ToolSpec = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };

/** رد جولة واحدة: النص (يُبث أولًا بأول عبر onText) وطلبات الأدوات، وتفاصيل التفكير التي يطلب OpenRouter إعادتها */
export type Turn = { text: string; toolCalls: ToolCall[]; reasoningDetails: unknown[] };

export class ProviderError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export type ProviderProblem = "invalid_key" | "location" | "credits" | "model" | "rate_limit" | "unavailable" | "network" | "other";

/** يقرأ رسالة المزود (Gemini يعيدها داخل مصفوفة، وOpenRouter كائنًا) ويحدد نوع المشكلة بدقة */
export function classifyProviderError(e: unknown): ProviderProblem {
  if (!(e instanceof ProviderError)) return "network";
  let text = e.message;
  try {
    const j = JSON.parse(e.message) as unknown;
    const err = (Array.isArray(j) ? j[0] : j) as { error?: { message?: string; status?: string } } | undefined;
    text = `${err?.error?.status ?? ""} ${err?.error?.message ?? ""} ${e.message}`;
  } catch { /* نص عادي */ }
  if (/location is not supported|FAILED_PRECONDITION/i.test(text)) return "location";
  if (/api[ _-]?key|API_KEY_INVALID|credential|unauthori[sz]ed|user not found/i.test(text) || e.status === 401) return "invalid_key";
  if (e.status === 402 || /insufficient credits|credit/i.test(text)) return "credits";
  if (e.status === 404 || /model.*(not found|not exist|not supported|invalid)|is not a valid model|no endpoints found/i.test(text)) return "model";
  if (e.status === 403) return "invalid_key";
  if (e.status === 429 || /RESOURCE_EXHAUSTED|quota|rate limit/i.test(text)) return "rate_limit";
  if (e.status >= 500) return "unavailable";
  return "other";
}

/** رسالة واضحة لكل مشكلة، بلغة المستخدم */
export function problemText(p: ProviderProblem): string {
  switch (p) {
    case "invalid_key": return tr("مفتاح الذكاء الاصطناعي غير صحيح أو أُلغي. انسخه من جديد من موقع المزود وأضفه في الإعدادات.");
    case "location": return tr("مزود الذكاء الاصطناعي لا يقبل الطلبات من منطقة الخادم. جرّب مفتاح OpenRouter بدلًا منه.");
    case "credits": return tr("رصيد حساب مزود الذكاء الاصطناعي لا يكفي. اشحن الرصيد ثم حاول مرة أخرى.");
    case "model": return tr("النموذج المحدد غير متاح لهذا المفتاح. اترك خانة النموذج فارغة ليُستخدم النموذج الافتراضي.");
    case "rate_limit": return tr("تجاوزت حد الاستخدام المسموح لدى المزود. انتظر دقيقة ثم حاول مرة أخرى.");
    case "unavailable": return tr("خدمة مزود الذكاء الاصطناعي متوقفة مؤقتًا. حاول بعد قليل.");
    case "network": return tr("تعذّر الوصول إلى مزود الذكاء الاصطناعي من الخادم. تحقق من الاتصال وحاول مرة أخرى.");
    default: return tr("تعذّر الحصول على رد من مزود الذكاء الاصطناعي، حاول مرة أخرى.");
  }
}

/** تجربة سريعة للمفتاح والنموذج: طلب صغير بلا بث، يرمي ProviderError عند الرفض */
export async function pingProvider(cfg: AssistantConfig, fetchImpl: typeof fetch = fetch): Promise<void> {
  const res = await fetchImpl(cfg.url, {
    method: "POST",
    signal: AbortSignal.timeout(20_000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify({ model: cfg.model, messages: [{ role: "user", content: "Reply with OK." }], max_tokens: 64 }),
  });
  if (!res.ok) throw new ProviderError(res.status, (await res.text().catch(() => "")).slice(0, 500));
}

/** جولة واحدة مع النموذج بالبث: يجمع النص وطلبات الأدوات المجزأة من أحداث SSE */
export async function streamTurn(
  cfg: AssistantConfig,
  messages: ChatMessage[],
  tools: ToolSpec[],
  onText: (chunk: string) => void,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<Turn> {
  const res = await fetchImpl(cfg.url, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.key}`,
      ...(cfg.provider === "openrouter" ? { "X-Title": "Hotel System Assistant" } : {}),
    },
    body: JSON.stringify({ model: cfg.model, messages, ...(tools.length ? { tools, tool_choice: "auto" } : {}), stream: true, temperature: 0.2 }),
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new ProviderError(res.status, detail.slice(0, 500));
  }
  return readStream(res.body, onText);
}

/** يقرأ بث SSE بصيغة OpenAI: نصوص delta.content، وأجزاء delta.tool_calls مرتبة بالفهرس */
export async function readStream(body: ReadableStream<Uint8Array>, onText: (chunk: string) => void): Promise<Turn> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const calls: ToolCall[] = [];
  const reasoning: unknown[] = [];
  let text = "";
  let buffer = "";
  const handle = (line: string) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let json: { choices?: { delta?: {
      content?: string | null;
      reasoning_details?: unknown[];
      tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string }; extra_content?: unknown }[];
    } }[] };
    try { json = JSON.parse(data); } catch { return; }
    const delta = json.choices?.[0]?.delta;
    if (!delta) return;
    if (delta.content) { text += delta.content; onText(delta.content); }
    if (delta.reasoning_details?.length) reasoning.push(...delta.reasoning_details);
    for (const [k, tc] of (delta.tool_calls ?? []).entries()) {
      const i = tc.index ?? k;
      const call = (calls[i] ??= { id: tc.id ?? `call_${i}`, type: "function", function: { name: "", arguments: "" } });
      if (tc.id) call.id = tc.id;
      if (tc.function?.name) call.function.name += tc.function.name;
      if (tc.function?.arguments) call.function.arguments += tc.function.arguments;
      if (tc.extra_content) call.extra_content = tc.extra_content;
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    lines.forEach(handle);
  }
  if (buffer) handle(buffer);
  return { text, toolCalls: calls.filter(Boolean), reasoningDetails: reasoning };
}
