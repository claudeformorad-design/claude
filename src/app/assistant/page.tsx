import type { Metadata } from "next";
import { Toaster } from "@/components/ui/toast";
import { Workspace } from "@/components/assistant/workspace";
import { navGroups } from "@/components/layout/nav-config";
import { requireAppContext } from "@/lib/auth/context";
import { assistantConfig } from "@/lib/assistant/provider";
import { getSettings, listConversations } from "@/services/assistant.service";
import { getI18n } from "@/i18n/server";

export const metadata: Metadata = { title: "المساعد" };

/** صفحة المساعد الكاملة: خارج إطار النظام، بشريطها الجانبي الخاص وزر العودة */
export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const ctx = await requireAppContext();
  const { t } = await getI18n();
  const sp = await searchParams;
  const [conversations, settings] = await Promise.all([listConversations(ctx.supabase, ctx.hotel.id), getSettings(ctx.supabase, ctx.hotel.id)]);
  const access = { modules: ctx.hotel.enabled_modules ?? ["accounting", "pms"], permissions: [...ctx.permissions] };
  const sections = navGroups(t.nav, access).flatMap((g) => g.items.map((i) => ({ label: i.label, group: g.title ?? "عام" })));
  const initial = sp.c && /^[0-9a-f-]{36}$/.test(sp.c) ? sp.c : undefined;
  return (
    <>
      <Toaster />
      <Workspace enabled={assistantConfig() !== null} userName={ctx.profile?.full_name ?? ""} hotelName={ctx.hotel.name_ar}
        initialConversation={initial} conversations={conversations} settings={settings} sections={sections} />
    </>
  );
}
