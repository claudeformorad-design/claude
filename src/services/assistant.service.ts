import { tr } from "@/i18n/tr";
import "server-only";
import type { SupabaseServerClient } from "@/lib/supabase/server";
import type {
  AssistantConversationRow, AssistantMessageRow, AssistantSavedRow, AssistantSettingsRow,
} from "@/lib/supabase/database.types";
import { raise } from "./errors";
import { searchTerm } from "@/lib/search-term";

/**
 * محادثات المساعد ومحفوظاته وتعليماته. كلها خاصة بالمستخدم نفسه:
 * قاعدة البيانات لا تعيد ولا تقبل إلا صفوف المستخدم الحالي في فندقه.
 */
export type Conversation = Pick<AssistantConversationRow, "id" | "title" | "pinned" | "updated_at">;
export type Message = Pick<AssistantMessageRow, "id" | "role" | "content" | "is_error" | "created_at">;
export type SavedAnswer = Pick<AssistantSavedRow, "id" | "conversation_id" | "question" | "content" | "created_at">;
export type AssistantSettings = Pick<AssistantSettingsRow, "instructions" | "open_mode">;

const DEFAULT_SETTINGS: AssistantSettings = { instructions: "", open_mode: "panel" };

/** عنوان المحادثة من أول سؤال: سطر واحد قصير */
export function titleFrom(question: string): string {
  const t = question.replace(/\s+/g, " ").trim();
  return (t.length > 60 ? `${t.slice(0, 58).trim()}…` : t) || tr("محادثة جديدة");
}

export async function listConversations(supabase: SupabaseServerClient, hotelId: string, q?: string): Promise<Conversation[]> {
  let query = supabase.from("assistant_conversations").select("id, title, pinned, updated_at").eq("hotel_id", hotelId);
  const s = searchTerm(q);
  if (s) query = query.ilike("title", `%${s}%`);
  const { data, error } = await query.order("pinned", { ascending: false }).order("updated_at", { ascending: false }).limit(200);
  raise(error);
  return (data ?? []) as Conversation[];
}

export async function getConversation(supabase: SupabaseServerClient, id: string) {
  const [c, m] = await Promise.all([
    supabase.from("assistant_conversations").select("id, title, pinned, updated_at").eq("id", id).maybeSingle(),
    supabase.from("assistant_messages").select("id, role, content, is_error, created_at").eq("conversation_id", id).order("created_at"),
  ]);
  raise(c.error);
  raise(m.error);
  return c.data ? { conversation: c.data as Conversation, messages: (m.data ?? []) as Message[] } : null;
}

export async function createConversation(supabase: SupabaseServerClient, hotelId: string, title: string): Promise<Conversation> {
  const { data, error } = await supabase.from("assistant_conversations").insert({ hotel_id: hotelId, title: titleFrom(title) })
    .select("id, title, pinned, updated_at").single();
  raise(error);
  return data as Conversation;
}

export async function addMessage(supabase: SupabaseServerClient, conversationId: string, role: "user" | "assistant", content: string, isError = false) {
  const { error } = await supabase.from("assistant_messages").insert({ conversation_id: conversationId, role, content: content.slice(0, 40000), is_error: isError });
  raise(error);
}

/** يحذف آخر رد للمساعد في المحادثة (لإعادة توليده) */
export async function dropLastAnswer(supabase: SupabaseServerClient, conversationId: string) {
  const { data, error } = await supabase.from("assistant_messages").select("id, role").eq("conversation_id", conversationId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  raise(error);
  if (data?.role === "assistant") raise((await supabase.from("assistant_messages").delete().eq("id", data.id)).error);
}

export async function updateConversation(supabase: SupabaseServerClient, id: string, patch: { title?: string; pinned?: boolean }) {
  const { error } = await supabase.from("assistant_conversations")
    .update({ ...(patch.title !== undefined ? { title: titleFrom(patch.title) } : {}), ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}) })
    .eq("id", id);
  raise(error);
}

export async function deleteConversation(supabase: SupabaseServerClient, id: string) {
  raise((await supabase.from("assistant_conversations").delete().eq("id", id)).error);
}

export async function listSaved(supabase: SupabaseServerClient, hotelId: string): Promise<SavedAnswer[]> {
  const { data, error } = await supabase.from("assistant_saved").select("id, conversation_id, question, content, created_at")
    .eq("hotel_id", hotelId).order("created_at", { ascending: false }).limit(200);
  raise(error);
  return (data ?? []) as SavedAnswer[];
}

export async function saveAnswer(supabase: SupabaseServerClient, hotelId: string, a: { conversationId?: string | null; question: string; content: string }) {
  const { data, error } = await supabase.from("assistant_saved")
    .insert({ hotel_id: hotelId, conversation_id: a.conversationId ?? null, question: a.question.slice(0, 8000), content: a.content.slice(0, 40000) })
    .select("id").single();
  raise(error);
  return data!.id as string;
}

export async function deleteSaved(supabase: SupabaseServerClient, id: string) {
  raise((await supabase.from("assistant_saved").delete().eq("id", id)).error);
}

export async function getSettings(supabase: SupabaseServerClient, hotelId: string): Promise<AssistantSettings> {
  const { data, error } = await supabase.from("assistant_settings").select("instructions, open_mode").eq("hotel_id", hotelId).maybeSingle();
  raise(error);
  return (data as AssistantSettings | null) ?? DEFAULT_SETTINGS;
}

export async function saveSettings(supabase: SupabaseServerClient, hotelId: string, patch: Partial<AssistantSettings>) {
  const { data, error } = await supabase.from("assistant_settings").select("hotel_id").eq("hotel_id", hotelId).maybeSingle();
  raise(error);
  raise((data
    ? await supabase.from("assistant_settings").update(patch).eq("hotel_id", hotelId)
    : await supabase.from("assistant_settings").insert({ hotel_id: hotelId, ...DEFAULT_SETTINGS, ...patch })).error);
}
