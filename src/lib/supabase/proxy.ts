import { type NextRequest, NextResponse } from "next/server";

/** تمرير الطلبات مباشرة إلى النظام الفندقي دون الحاجة لتسجيل دخول */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname;

  // إذا حاول المستخدم فتح صفحة الدخول أو الإعداد، يتم توجيهه مباشرة للنظام
  if (pathname === "/login" || pathname === "/onboarding") {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  return NextResponse.next({ request });
}
