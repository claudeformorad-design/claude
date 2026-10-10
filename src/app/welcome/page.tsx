import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { tr } from "@/i18n/tr";
import { getAppContext } from "@/lib/auth/context";
import { Intro } from "./intro";

export const metadata: Metadata = { get title() { return tr("أهلًا بك في نزيل"); } };

/** تعريف أول استخدام بعد «ابدأ»، و?replay=1 يعيد عرضه بطلب صريح */
export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ replay?: string }> }) {
  const ctx = await getAppContext();
  if (!ctx.user) redirect("/login");
  const { replay } = await searchParams;
  return <Intro next="/" replay={replay === "1"} />;
}
