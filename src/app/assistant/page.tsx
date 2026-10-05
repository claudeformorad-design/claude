import { localNameOf } from "@/lib/local-name";
import { tr } from "@/i18n/tr";
import type { Metadata } from "next";
import { Toaster } from "@/components/ui/toast";
import { Workspace } from "@/components/assistant/workspace";
import { navGroups } from "@/components/layout/nav-config";
import { requireAppContext } from "@/lib/auth/context";
import { getAssistantConfig } from "@/lib/assistant/provider";
import { isSystemAdmin } from "@/lib/auth/owner";
import { getSettings, listConversations } from "@/services/assistant.service";
import { getI18n } from "@/i18n/server";

export const metadata: Metadata = { get title() { return tr("المساعد"); } };

/** صفحة المساعد الكاملة: خارج إطار النظام، بشريطها الجانبي الخاص وزر العودة */
export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const ctx = await requireAppContext();
  const { t } = await getI18n();
  const sp = await searchParams;
  const [conversations, settings, config] = await Promise.all([
    listConversations(ctx.supabase, ctx.hotel.id), getSettings(ctx.supabase, ctx.hotel.id), getAssistantConfig().catch(() => null),
  ]);
  const canSetup = config === null && (await isSystemAdmin(ctx));
  const access = { modules: ctx.hotel.enabled_modules ?? ["accounting", "pms"], permissions: [...ctx.permissions] };
  const sections = navGroups(t.nav, access).flatMap((g) => g.items.map((i) => ({ label: i.label, group: g.title ?? tr("عام") })));
  const initial = sp.c && /^[0-9a-f-]{36}$/.test(sp.c) ? sp.c : undefined;
  return (
    <>
      <Toaster />
      <Workspace enabled={config !== null} canSetup={canSetup} userName={ctx.profile?.full_name ?? ""} hotelName={localNameOf(ctx.hotel)}
        initialConversation={initial} conversations={conversations} settings={settings} sections={sections} />
    </>
  );
}
