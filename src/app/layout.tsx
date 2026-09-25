import type { Metadata } from "next";
import { IBM_Plex_Sans_Arabic, Inter } from "next/font/google";
import { directionOf } from "@/i18n/config";
import { getI18n } from "@/i18n/server";
import "./globals.css";

const arabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-arabic",
  display: "swap",
});
const latin = Inter({ subsets: ["latin"], variable: "--font-latin", display: "swap" });

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: { default: t.app.name, template: `%s · ${t.app.shortName}` } };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale } = await getI18n();
  return (
    <html lang={locale} dir={directionOf(locale)} className={`${arabic.variable} ${latin.variable}`}>
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
