"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const hotelSchema = z.object({
  name_ar: z.string().trim().min(1).max(200),
  name_en: z.string().trim().max(200).optional(),
  country_code: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
  base_currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  fiscal_year_start_month: z.coerce.number().int().min(1).max(12),
  timezone: z.string().trim().min(1),
});

export type OnboardingState = { error: string } | null;

const MODULES = ["accounting", "pms"] as const;

export async function createHotelAction(_prev: OnboardingState, formData: FormData): Promise<OnboardingState> {
  const parsed = hotelSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "validation" };
  // الأقسام المختارة (المحاسبة و/أو إدارة الفندق) — قسم واحد على الأقل
  const modules = MODULES.filter((m) => formData.getAll("modules").includes(m));
  if (modules.length === 0) return { error: "اختر قسمًا واحدًا على الأقل: المحاسبة أو إدارة الفندق" };

  const supabase = await createClient();
  const { data: hotelId, error } = await supabase.rpc("create_hotel", {
    p_name_ar: parsed.data.name_ar,
    p_name_en: parsed.data.name_en || null,
    p_country_code: parsed.data.country_code,
    p_base_currency: parsed.data.base_currency,
    p_fiscal_year_start_month: parsed.data.fiscal_year_start_month,
    p_timezone: parsed.data.timezone,
  });
  if (error) return { error: error.message };
  if (modules.length < MODULES.length) {
    const r = await supabase.rpc("set_hotel_modules", { p_hotel_id: hotelId as string, p_modules: [...modules] });
    if (r.error) return { error: r.error.message };
  }
  redirect(modules.includes("accounting") ? "/" : "/front-desk");
}
