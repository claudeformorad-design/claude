"use server";

import { z } from "zod";
import { getAppContext, type AppContext } from "@/lib/auth/context";
import {
  deleteConversation, deleteSaved, getConversation, getSettings, listConversations, listSaved, saveAnswer, saveSettings,
  updateConversation, type AssistantSettings, type Conversation, type Message, type SavedAnswer,
} from "@/services/assistant.service";
import { type ActionResult, toActionResult } from "@/services/errors";

/** عمليات المساعد: كلها على بيانات المستخدم نفسه فقط، وقاعدة البيانات تفرض ذلك */
async function withUser<T>(fn: (ctx: AppContext) => Promise<T>): Promise<ActionResult<T>> {
  const ctx = await getAppContext();
  if (!ctx.user || !ctx.hotel) return { ok: false, error: "permission_denied" };
  return toActionResult(() => fn(ctx as AppContext));
}

const id = z.uuid();

export async function listConversationsAction(q?: string): Promise<ActionResult<Conversation[]>> {
  return withUser((ctx) => listConversations(ctx.supabase, ctx.hotel.id, typeof q === "string" ? q.slice(0, 100) : undefined));
}

export async function getConversationAction(conversationId: string): Promise<ActionResult<{ conversation: Conversation; messages: Message[] } | null>> {
  if (!id.safeParse(conversationId).success) return { ok: false, error: "validation" };
  return withUser((ctx) => getConversation(ctx.supabase, conversationId));
}

export async function updateConversationAction(conversationId: string, patch: { title?: string; pinned?: boolean }): Promise<ActionResult> {
  const p = z.object({ title: z.string().trim().min(1).max(120).optional(), pinned: z.boolean().optional() }).safeParse(patch);
  if (!id.safeParse(conversationId).success || !p.success) return { ok: false, error: "validation" };
  return withUser(async (ctx) => { await updateConversation(ctx.supabase, conversationId, p.data); return undefined; });
}

export async function deleteConversationAction(conversationId: string): Promise<ActionResult> {
  if (!id.safeParse(conversationId).success) return { ok: false, error: "validation" };
  return withUser(async (ctx) => { await deleteConversation(ctx.supabase, conversationId); return undefined; });
}

export async function listSavedAction(): Promise<ActionResult<SavedAnswer[]>> {
  return withUser((ctx) => listSaved(ctx.supabase, ctx.hotel.id));
}

export async function saveAnswerAction(a: { conversationId?: string | null; question: string; content: string }): Promise<ActionResult<string>> {
  const p = z.object({ conversationId: z.uuid().nullish(), question: z.string().max(8000), content: z.string().min(1).max(40000) }).safeParse(a);
  if (!p.success) return { ok: false, error: "validation" };
  return withUser((ctx) => saveAnswer(ctx.supabase, ctx.hotel.id, p.data));
}

export async function deleteSavedAction(savedId: string): Promise<ActionResult> {
  if (!id.safeParse(savedId).success) return { ok: false, error: "validation" };
  return withUser(async (ctx) => { await deleteSaved(ctx.supabase, savedId); return undefined; });
}

export async function getSettingsAction(): Promise<ActionResult<AssistantSettings>> {
  return withUser((ctx) => getSettings(ctx.supabase, ctx.hotel.id));
}

export async function saveSettingsAction(patch: Partial<AssistantSettings>): Promise<ActionResult> {
  const p = z.object({ instructions: z.string().max(2000).optional(), open_mode: z.enum(["panel", "page"]).optional() }).safeParse(patch);
  if (!p.success) return { ok: false, error: "validation" };
  return withUser(async (ctx) => { await saveSettings(ctx.supabase, ctx.hotel.id, p.data); return undefined; });
}
