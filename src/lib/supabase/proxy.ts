import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import type { Database } from "./database.types";
import { isSupabaseConfigured, supabaseEnv } from "./env";

const PUBLIC_PATHS = ["/login", "/survey/"];

/**
 * التثبيت المحلي (بدون Supabase): تسجيل الدخول يتحقق منه الخادم بجلسة محلية، أو لا دخول في وضع المستخدم الواحد.
 * مع Supabase: تحديث الجلسة في كل طلب وتحويل غير المسجلين إلى صفحة الدخول.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  // التثبيت المحلي: الجلسة تُتحقق في الخادم نفسه (صفحة الدخول تعيد للرئيسية في وضع المستخدم الواحد)
  if (!isSupabaseConfigured()) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const { url, anonKey } = supabaseEnv();

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getClaims يجدد الجلسة عند انتهائها ويتحقق من توقيع الرمز: محليًا بمفاتيح التوقيع غير المتماثلة
  // (بلا طلب شبكة)، أو لدى خادم Supabase إن كان المشروع على المفتاح القديم. لا يُكتفى بقراءة الكوكي.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims ?? null;

  const isPublic = PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p));
  if (!user && !isPublic) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }
  return response;
}
