import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";
import type { Database } from "./database.types";
import { isSupabaseConfigured, supabaseEnv } from "./env";
import { createLocalSupabaseClient } from "./local-client";
import { currentLocalUserId } from "./local-auth";

/** عميل Supabase للخادم (Server Components / Server Actions) — يعمل بالعميل المحلي إن لم تكن Supabase مهيأة */
export async function createClient() {
  if (!isSupabaseConfigured()) {
    // يجعل الصفحة ديناميكية (لا تُولَّد وقت البناء): البيانات تُقرأ من القاعدة المحلية عند كل طلب
    await connection();
    // المستخدم من جلسة الدخول المحلية (أو مالك النظام في وضع المستخدم الواحد)
    return createLocalSupabaseClient(await currentLocalUserId()) as unknown as ReturnType<typeof createServerClient<Database>>;
  }

  const cookieStore = await cookies();
  const { url, anonKey } = supabaseEnv();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // يُستدعى من Server Component حيث لا يمكن كتابة الكوكيز؛ ملف proxy.ts يتولى تحديث الجلسة
        }
      },
    },
  });
}

export type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;
