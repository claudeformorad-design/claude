import "server-only";
import type { SupabaseServerClient } from "@/lib/supabase/server";
import { formatMoney, type MoneyInput } from "@/lib/accounting/money";
import { TEMPLATE_KEYS, type TemplateKey, fillTemplate, normalizePhone, templateFor } from "@/lib/whatsapp";
import { raise } from "./errors";

type Hotel = { id: string; name_ar: string; phone: string | null; country_code: string; base_currency: string };

/** نصوص الرسائل الخاصة بالفندق (ما لم يغيّره يبقى بالنص الافتراضي) */
export async function loadTemplates(supabase: SupabaseServerClient, hotelId: string): Promise<Partial<Record<TemplateKey, string>>> {
  const { data, error } = await supabase.from("message_templates").select("key, body").eq("hotel_id", hotelId);
  raise(error);
  const out: Partial<Record<TemplateKey, string>> = {};
  for (const r of (data ?? []) as { key: string; body: string }[]) if ((TEMPLATE_KEYS as readonly string[]).includes(r.key)) out[r.key as TemplateKey] = r.body;
  return out;
}

/** مُجهِّز الرسائل لصفحة واحدة: يحمّل النصوص مرة، ويبني الرسالة والرقم الدولي لكل زر */
export async function messageBuilder(supabase: SupabaseServerClient, hotel: Hotel) {
  const custom = await loadTemplates(supabase, hotel.id);
  return {
    money: (v: MoneyInput, currency = hotel.base_currency) => `${formatMoney(v, { locale: "ar" })} ${currency}`,
    phone: (raw: string | null | undefined) => normalizePhone(raw, hotel.country_code),
    text: (key: TemplateKey, vars: Record<string, string | number | null | undefined>) =>
      fillTemplate(templateFor(key, custom), { hotel: hotel.name_ar, hotel_phone: hotel.phone, ...vars }),
  };
}
