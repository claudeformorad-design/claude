import type { Metadata } from "next";
import localFont from "next/font/local";
import { Inter } from "next/font/google";
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

/** أرقام بعرض ثابت للمبالغ والجداول (أرقام «ثمانية» متغيرة العرض فلا تصطف الفواصل العشرية) */
const digits = Inter({ subsets: ["latin"], variable: "--font-digits", display: "swap" });

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: { default: t.app.name, template: `%s · ${t.app.shortName}` } };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale } = await getI18n();
  return (
    <html lang={locale} dir={directionOf(locale)} className={`${thmanyah.variable} ${digits.variable}`}>
      <body className="min-h-screen font-sans">
        {children}
      </body>
    </html>
  );
}
