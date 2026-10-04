import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import type { Database } from "./database.types";
import { isSupabaseConfigured, SESSION_COOKIE_OPTIONS, supabaseEnv } from "./env";

const PUBLIC_PATHS = ["/login", "/survey/"];

/**
 * سياسة أمان المحتوى برمز (nonce) جديد لكل طلب: لا يُنفَّذ أي سكربت إلا سكربتات النظام نفسه،
 * فلا يعمل أي سكربت محقون حتى لو وصل نص خبيث إلى الصفحة. ولا تُعرض الصفحات داخل إطار موقع آخر.
 */
function securityPolicy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV !== "production";
  const https = request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "worker-src 'self' blob:",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
  return { nonce, csp, https };
}

/** تمرير الطلب مع الرمز للصفحات، وإضافة رؤوس الأمان للاستجابة */
function forward(request: NextRequest, policy: ReturnType<typeof securityPolicy>): NextResponse {
  const headers = new Headers(request.headers);
  headers.set("x-nonce", policy.nonce);
  headers.set("content-security-policy", policy.csp);
  return withSecurityHeaders(NextResponse.next({ request: { headers } }), policy);
}

function withSecurityHeaders(response: NextResponse, policy: ReturnType<typeof securityPolicy>): NextResponse {
  response.headers.set("Content-Security-Policy", policy.csp);
  if (policy.https) response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  return response;
}

/**
 * التثبيت المحلي (بدون Supabase): تسجيل الدخول يتحقق منه الخادم بجلسة محلية، أو لا دخول في وضع المستخدم الواحد.
 * مع Supabase: تحديث الجلسة في كل طلب وتحويل غير المسجلين إلى صفحة الدخول.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const policy = securityPolicy(request);
  // التثبيت المحلي: الجلسة تُتحقق في الخادم نفسه (صفحة الدخول تعيد للرئيسية في وضع المستخدم الواحد)
  if (!isSupabaseConfigured()) return forward(request, policy);

  let response = forward(request, policy);
  const { url, anonKey } = supabaseEnv();

  const supabase = createServerClient<Database>(url, anonKey, {
    // كوكي الجلسة لا يقرؤها JavaScript في المتصفح (لا يوجد عميل Supabase في المتصفح أصلًا)
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = forward(request, policy);
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
    return withSecurityHeaders(NextResponse.redirect(redirectUrl), policy);
  }
  return response;
}
