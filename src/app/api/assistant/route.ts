import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppContext, type AppContext } from "@/lib/auth/context";
import { assistantConfig, ProviderError, streamTurn, type ChatMessage } from "@/lib/assistant/provider";
import { systemPrompt } from "@/lib/assistant/prompt";
import { TOOL_SPECS, runTool } from "@/lib/assistant/tools";
import { getI18n } from "@/i18n/server";

export const maxDuration = 60;

const body = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) })).min(1).max(40),
  page: z.object({ path: z.string().max(300), title: z.string().max(200).optional(), text: z.string().max(4000).optional() }),
});

/** أقصى عدد جولات أدوات في السؤال الواحد، حتى لا تطول المحادثة أو تكلفتها */
const MAX_ROUNDS = 8;

const friendly = (e: unknown) => {
  if (e instanceof ProviderError) {
    if (e.status === 401 || e.status === 403) return "مفتاح مزود الذكاء الاصطناعي غير صالح أو بلا صلاحية، راجع إعداده على الخادم.";
    if (e.status === 404) return "النموذج المحدد غير متاح لدى المزود، راجع قيمة AI_MODEL.";
    if (e.status === 429) return "تجاوزت حد الاستخدام لدى المزود، حاول بعد قليل.";
    return "تعذّر الحصول على رد من مزود الذكاء الاصطناعي، حاول مرة أخرى.";
  }
  if (e instanceof Error && e.name === "AbortError") return "أُوقف الرد.";
  return "تعذّر الاتصال بمزود الذكاء الاصطناعي، تحقق من الاتصال وحاول مرة أخرى.";
};

/**
 * محادثة المساعد: يبث الرد سطرًا سطرًا بصيغة NDJSON
 * {type:"text"} أجزاء النص، {type:"tool"} الأداة التي يقرأ بها الآن، ثم {type:"done"} أو {type:"error"}.
 */
export async function POST(request: Request) {
  const cfg = assistantConfig();
  if (!cfg) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const ctx = await getAppContext();
  if (!ctx.user || !ctx.hotel) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const app = ctx as AppContext;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "validation" }, { status: 400 });

  const { locale, t } = await getI18n();
  const messages: ChatMessage[] = [{ role: "system", content: systemPrompt(app, t, parsed.data.page) }, ...parsed.data.messages.slice(-16)];
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: Record<string, unknown>) => controller.enqueue(encoder.encode(`${JSON.stringify(o)}\n`));
      try {
        for (let round = 0; ; round++) {
          const last = round === MAX_ROUNDS;
          const turn = await streamTurn(cfg, messages, last ? [] : TOOL_SPECS, (text) => send({ type: "text", text }), request.signal);
          if (!turn.toolCalls.length || last) break;
          messages.push({
            role: "assistant", content: turn.text || null, tool_calls: turn.toolCalls,
            ...(turn.reasoningDetails.length ? { reasoning_details: turn.reasoningDetails } : {}),
          });
          for (const call of turn.toolCalls) {
            send({ type: "tool", name: call.function.name });
            messages.push({ role: "tool", tool_call_id: call.id, content: await runTool(app, t, locale, call.function.name, call.function.arguments) });
          }
        }
        send({ type: "done" });
      } catch (e) {
        send({ type: "error", message: friendly(e) });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
