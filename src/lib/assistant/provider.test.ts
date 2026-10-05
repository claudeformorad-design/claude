import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { assistantConfig, readStream, streamTurn, ProviderError, classifyProviderError, providerFromKey, maskKey, buildConfig } = await import("./provider");

const sse = (events: unknown[]) => {
  const text = events.map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`).join("");
  // تقسيم متعمد في منتصف الأسطر كما يصل عبر الشبكة
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(c) { for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7)); c.close(); },
  });
};

describe("readStream", () => {
  it("collects streamed text and emits each chunk", async () => {
    const chunks: string[] = [];
    const turn = await readStream(sse([
      { choices: [{ delta: { content: "الميزان " } }] },
      { choices: [{ delta: { content: "متوازن" } }] },
      "[DONE]",
    ]), (c) => chunks.push(c));
    expect(turn.text).toBe("الميزان متوازن");
    expect(chunks).toEqual(["الميزان ", "متوازن"]);
    expect(turn.toolCalls).toEqual([]);
  });

  it("assembles tool calls split across chunks and keeps Gemini signatures", async () => {
    const turn = await readStream(sse([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "run_report", arguments: "{\"report\":" } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "\"trial-balance\"}" }, extra_content: { google: { thought_signature: "sig" } } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 1, id: "c2", function: { name: "hotel_snapshot", arguments: "{}" } }] } }] },
      { choices: [{ delta: { reasoning_details: [{ type: "reasoning.encrypted", data: "x" }] } }] },
    ]), () => {});
    expect(turn.toolCalls).toEqual([
      { id: "c1", type: "function", function: { name: "run_report", arguments: "{\"report\":\"trial-balance\"}" }, extra_content: { google: { thought_signature: "sig" } } },
      { id: "c2", type: "function", function: { name: "hotel_snapshot", arguments: "{}" } },
    ]);
    expect(turn.reasoningDetails).toHaveLength(1);
  });
});

describe("assistantConfig", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("is off without any key", () => {
    vi.stubEnv("GEMINI_API_KEY", ""); vi.stubEnv("GOOGLE_API_KEY", ""); vi.stubEnv("OPENROUTER_API_KEY", "");
    expect(assistantConfig()).toBeNull();
  });
  it("prefers Gemini, and switches to OpenRouter on request", () => {
    vi.stubEnv("GEMINI_API_KEY", "g"); vi.stubEnv("OPENROUTER_API_KEY", "o"); vi.stubEnv("AI_MODEL", ""); vi.stubEnv("AI_BASE_URL", "");
    expect(assistantConfig()).toMatchObject({ provider: "gemini", key: "g", model: "gemini-flash-latest" });
    vi.stubEnv("AI_PROVIDER", "openrouter");
    expect(assistantConfig()).toMatchObject({ provider: "openrouter", key: "o", url: "https://openrouter.ai/api/v1/chat/completions" });
  });
});

describe("streamTurn", () => {
  it("sends the key only in the server request and reports provider errors", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad key", { status: 401 }));
    const cfg = { provider: "gemini" as const, url: "https://x/chat/completions", key: "secret", model: "m" };
    await expect(streamTurn(cfg, [{ role: "user", content: "hi" }], [], () => {}, undefined, fetchImpl as unknown as typeof fetch))
      .rejects.toBeInstanceOf(ProviderError);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret");
    expect(JSON.parse(init.body as string)).not.toHaveProperty("tools");
  });
});

describe("provider diagnostics", () => {
  const gemini = (code: number, status: string, message: string) => new ProviderError(code, JSON.stringify([{ error: { code, message, status } }]));
  it("reads Gemini errors wrapped in an array", () => {
    expect(classifyProviderError(gemini(400, "INVALID_ARGUMENT", "API key not valid. Please pass a valid API key."))).toBe("invalid_key");
    expect(classifyProviderError(gemini(400, "FAILED_PRECONDITION", "User location is not supported for the API use."))).toBe("location");
    expect(classifyProviderError(gemini(429, "RESOURCE_EXHAUSTED", "Resource has been exhausted (e.g. check quota)."))).toBe("rate_limit");
    expect(classifyProviderError(gemini(404, "NOT_FOUND", "models/gemini-9 is not found for API version v1beta"))).toBe("model");
    expect(classifyProviderError(gemini(503, "UNAVAILABLE", "The model is overloaded."))).toBe("unavailable");
  });
  it("reads OpenRouter errors and network failures", () => {
    expect(classifyProviderError(new ProviderError(401, JSON.stringify({ error: { message: "No auth credentials found", code: 401 } })))).toBe("invalid_key");
    expect(classifyProviderError(new ProviderError(402, JSON.stringify({ error: { message: "Insufficient credits", code: 402 } })))).toBe("credits");
    expect(classifyProviderError(new TypeError("fetch failed"))).toBe("network");
  });
  it("recognizes key types and never shows more than the last four characters", () => {
    expect(providerFromKey("AIzaSyA1234567890abcdefghijklmnopqrs")).toBe("gemini");
    expect(providerFromKey("sk-or-v1-0123456789abcdef0123456789")).toBe("openrouter");
    expect(providerFromKey("sk-proj-something")).toBeNull();
    expect(providerFromKey("AIza with space")).toBeNull();
    expect(maskKey("AIzaSyA1234567890abcdefghijklmnopqrs")).toBe("••••pqrs");
    expect(buildConfig("gemini", "k").url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect(buildConfig("openrouter", "k", "  ").model).toBe("google/gemini-3.8-flash");
  });
});
