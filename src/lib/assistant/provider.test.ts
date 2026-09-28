import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { assistantConfig, readStream, streamTurn, ProviderError } = await import("./provider");

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
