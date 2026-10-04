export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return false;
  if (url.includes("your-project.supabase.co") || anonKey.includes("your-anon")) return false;
  return true;
}

export function supabaseEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY — copy .env.example to .env.local");
  }
  return { url, anonKey };
}

/** خيارات كوكي جلسة Supabase: غير مقروءة من JavaScript، وآمنة على HTTPS، ولا تُرسل مع طلبات المواقع الأخرى */
export const SESSION_COOKIE_OPTIONS = {
  path: "/",
  sameSite: "lax" as const,
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
};
