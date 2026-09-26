import type { Metadata } from "next";
import { Readex_Pro } from "next/font/google";
import { directionOf } from "@/i18n/config";
import { getI18n } from "@/i18n/server";
import "./globals.css";

// خط عربي/لاتيني هندسي حديث بأوزان متغيرة
const readex = Readex_Pro({
  subsets: ["arabic", "latin"],
  variable: "--font-readex",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: { default: t.app.name, template: `%s · ${t.app.shortName}` } };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale } = await getI18n();
  return (
    <html lang={locale} dir={directionOf(locale)} className={readex.variable}>
      <body className="min-h-screen font-sans">
        {children}
      </body>
    </html>
  );
}
