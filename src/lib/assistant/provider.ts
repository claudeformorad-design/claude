import "server-only";

/**
 * الاتصال بنموذج المساعد عبر واجهة متوافقة مع OpenAI (Chat Completions):
 * Google Gemini مباشرة، أو OpenRouter. المفتاح يبقى على الخادم في متغيرات البيئة ولا يصل للمتصفح.
 *
 * GEMINI_API_KEY أو OPENROUTER_API_KEY: مفتاح المزود (يكفي أحدهما)
 * AI_PROVIDER: gemini أو openrouter، عند وجود المفتاحين معًا (الافتراضي gemini)
 * AI_MODEL: اسم النموذج، والافتراضي أحدث Flash من جوجل
 * AI_BASE_URL: عنوان بديل متوافق مع نفس الواجهة، اختياري (وكيل داخلي أو خادم اختبار)
 */
export type AssistantConfig = { provider: "gemini" | "openrouter"; url: string; key: string; model: string };

export function assistantConfig(): AssistantConfig | null {
  const gemini = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const openrouter = process.env.OPENROUTER_API_KEY;
  const choice = process.env.AI_PROVIDER === "openrouter" ? "openrouter" : process.env.AI_PROVIDER === "gemini" ? "gemini" : gemini ? "gemini" : "openrouter";
  const model = process.env.AI_MODEL?.trim();
  const base = process.env.AI_BASE_URL?.trim().replace(/\/+$/, "");
  if (choice === "gemini" && gemini) {
    const url = `${base || "https://generativelanguage.googleapis.com/v1beta/openai"}/chat/completions`;
    return { provider: "gemini", url, key: gemini, model: model || "gemini-flash-latest" };
  }
  if (choice === "openrouter" && openrouter) {
    const url = `${base || "https://openrouter.ai/api/v1"}/chat/completions`;
    return { provider: "openrouter", url, key: openrouter, model: model || "google/gemini-3.8-flash" };
  }
  return null;
}

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
