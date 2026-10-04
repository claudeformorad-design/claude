import { tr } from "@/i18n/tr";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppContext, type AppContext } from "@/lib/auth/context";
import { assistantConfig, ProviderError, streamTurn, type ChatMessage } from "@/lib/assistant/provider";
import { systemPrompt } from "@/lib/assistant/prompt";
import { TOOL_SPECS, runTool } from "@/lib/assistant/tools";
import { addMessage, createConversation, dropLastAnswer, getConversation, getSettings } from "@/services/assistant.service";
import { getI18n } from "@/i18n/server";

export const maxDuration = 120;

const body = z.object({
  conversationId: z.uuid().optional(),
  question: z.string().trim().max(8000).optional(),
  /** إعادة توليد آخر رد في المحادثة بدل سؤال جديد */
  retry: z.boolean().optional(),
  page: z.object({ path: z.string().max(300), title: z.string().max(200).optional(), text: z.string().max(4000).optional() }).optional(),
});

/** أقصى عدد جولات أدوات في السؤال الواحد، حتى لا تطول المحادثة أو تكلفتها */
const MAX_ROUNDS = 12;
/** آخر الرسائل التي تُرسل للنموذج من تاريخ المحادثة */
const HISTORY = 20;

const friendly = (e: unknown) => {
  if (e instanceof ProviderError) {
    if (e.status === 401 || e.status === 403) return tr("مفتاح مزود الذكاء الاصطناعي غير صالح أو بلا صلاحية، راجع إعداده على الخادم.");
    if (e.status === 404) return tr("النموذج المحدد غير متاح لدى المزود، راجع قيمة AI_MODEL.");
    if (e.status === 429) return tr("تجاوزت حد الاستخدام لدى المزود، حاول بعد قليل.");
    return tr("تعذّر الحصول على رد من مزود الذكاء الاصطناعي، حاول مرة أخرى.");
  }
  return tr("تعذّر الاتصال بمزود الذكاء الاصطناعي، تحقق من الاتصال وحاول مرة أخرى.");
};

/**
 * محادثة المساعد: تُحفظ في قاعدة البيانات لكل مستخدم، ويُبث الرد سطرًا سطرًا بصيغة NDJSON:
 * {type:"conversation"} المحادثة (تُنشأ مع أول سؤال)، {type:"text"} أجزاء النص،
 * {type:"tool"} الأداة التي يقرأ بها الآن، ثم {type:"done"} أو {type:"error"}.
 */
export async function POST(request: Request) {
  const cfg = assistantConfig();
  if (!cfg) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const ctx = await getAppContext();
  if (!ctx.user || !ctx.hotel) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const app = ctx as AppContext;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success || (!parsed.data.question && !parsed.data.retry)) return NextResponse.json({ error: "validation" }, { status: 400 });
  const { conversationId, question, retry, page } = parsed.data;

  // المحادثة: القائمة (وقاعدة البيانات تمنع محادثات غير المستخدم) أو جديدة بعنوان من السؤال
  let conversation = conversationId ? (await getConversation(app.supabase, conversationId))?.conversation : undefined;
  if (conversationId && !conversation) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!conversation) {
    if (!question) return NextResponse.json({ error: "validation" }, { status: 400 });
    conversation = await createConversation(app.supabase, app.hotel.id, question);
  }
  const convId = conversation.id;
  if (retry) await dropLastAnswer(app.supabase, convId);
  else await addMessage(app.supabase, convId, "user", question!);

  const [{ locale, t }, settings, history] = await Promise.all([getI18n(), getSettings(app.supabase, app.hotel.id), getConversation(app.supabase, convId)]);
  const past = (history?.messages ?? []).filter((m) => !m.is_error).slice(-HISTORY);
  if (!past.length || past.at(-1)!.role !== "user") return NextResponse.json({ error: "validation" }, { status: 400 });
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(app, t, page ?? { path: "/assistant" }, settings.instructions) },
    ...past.map((m) => ({ role: m.role, content: m.content })),
  ];
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: Record<string, unknown>) => { try { controller.enqueue(encoder.encode(`${JSON.stringify(o)}\n`)); } catch { /* أغلق المستخدم الاتصال */ } };
      send({ type: "conversation", id: convId, title: conversation.title });
      let answer = "";
      try {
        for (let round = 0; ; round++) {
          const last = round === MAX_ROUNDS;
          if (answer && !answer.endsWith("\n")) answer += "\n\n";
          const turn = await streamTurn(cfg, messages, last ? [] : TOOL_SPECS, (text) => { answer += text; send({ type: "text", text }); }, request.signal);
          if (!turn.toolCalls.length || last) break;
          messages.push({
            role: "assistant", content: turn.text || null, tool_calls: turn.toolCalls,
            ...(turn.reasoningDetails.length ? { reasoning_details: turn.reasoningDetails } : {}),
          });
          // الأدوات المطلوبة في الجولة الواحدة تعمل معًا، وتُضاف نتائجها بترتيب طلبها
          for (const call of turn.toolCalls) send({ type: "tool", name: call.function.name });
          const outputs = await Promise.all(turn.toolCalls.map((call) => runTool(app, t, locale, call.function.name, call.function.arguments)));
          turn.toolCalls.forEach((call, i) => messages.push({ role: "tool", tool_call_id: call.id, content: outputs[i]! }));
        }
        if (answer.trim()) await addMessage(app.supabase, convId, "assistant", answer.trim());
        send({ type: "done" });
      } catch (e) {
        const aborted = request.signal.aborted || (e instanceof Error && e.name === "AbortError");
        // الرد الجزئي عند الإيقاف يبقى في المحادثة، والخطأ يُحفظ مميزًا ولا يُرسل للنموذج لاحقًا
        if (aborted) { if (answer.trim()) await addMessage(app.supabase, convId, "assistant", answer.trim()).catch(() => {}); }
        else {
          const message = friendly(e);
          await addMessage(app.supabase, convId, "assistant", message, true).catch(() => {});
          send({ type: "error", message });
        }
      }
      try { controller.close(); } catch { /* مغلق مسبقًا */ }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
