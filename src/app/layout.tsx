import { tr } from "@/i18n/tr";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import localFont from "next/font/local";
import { Inter } from "next/font/google";
import { MotionProvider } from "@/components/motion-provider";
import { directionOf } from "@/i18n/config";
import { getI18n } from "@/i18n/server";
import "./globals.css";

/**
 * خط النظام: «ثمانية» (thmanyah sans). لا يوجد وزن 400 في الملفات، فيُربط النص العادي بالوزن
 * المتوسط (أوضح وأعلى تباينًا)، و600 بالعريض، و800 بالأسود.
 */
const thmanyah = localFont({
  src: [
    { path: "./fonts/thmanyahsans-Light.woff2", weight: "300", style: "normal" },
    { path: "./fonts/thmanyahsans-Medium.woff2", weight: "400", style: "normal" },
    { path: "./fonts/thmanyahsans-Medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/thmanyahsans-Bold.woff2", weight: "600", style: "normal" },
    { path: "./fonts/thmanyahsans-Bold.woff2", weight: "700", style: "normal" },
    { path: "./fonts/thmanyahsans-Black.woff2", weight: "800", style: "normal" },
    { path: "./fonts/thmanyahsans-Black.woff2", weight: "900", style: "normal" },
  ],
  variable: "--font-thmanyah",
  display: "swap",
  preload: true,
});

/**
 * أرقام بعرض ثابت للمبالغ والجداول (أرقام «ثمانية» متغيرة العرض فلا تصطف الفواصل العشرية).
 * بلا خط احتياطي معدَّل، فالحروف العربية داخل الأرقام (ر.ي، أسماء القاعات) تأخذ «ثمانية» لا Arial.
 */
const digits = Inter({ subsets: ["latin"], variable: "--font-digits", display: "swap", adjustFontFallback: false });

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: { default: t.app.name, template: tr("%s، {0}", t.app.shortName) } };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale } = await getI18n();
  const density = (await cookies()).get("table_density")?.value === "compact" ? "compact" : "comfortable";
  return (
    <html lang={locale} dir={directionOf(locale)} data-density={density} className={`${thmanyah.variable} ${digits.variable}`}>
      <body className="min-h-screen font-sans">
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
