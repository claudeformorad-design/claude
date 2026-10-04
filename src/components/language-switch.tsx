"use client";

import { useTransition } from "react";
import { Languages } from "lucide-react";
import { currentLocale } from "@/i18n/tr";
import { setLocaleAction } from "@/app/locale-actions";
import { cn } from "@/lib/utils";

/** زر تبديل اللغة: يعرض اسم اللغة الأخرى بلغتها، ويعيد تحميل الصفحة باتجاهها الجديد */
export function LanguageSwitch({ className }: { className?: string }) {
  const [pending, start] = useTransition();
  const next = currentLocale() === "en" ? "ar" : "en";
  return (
    <button type="button" disabled={pending} lang={next} title={next === "en" ? "English" : "العربية"}
      onClick={() => start(async () => { await setLocaleAction(next); window.location.reload(); })}
      className={cn("flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-[15px] font-medium text-slate-600 transition-colors hover:text-ink disabled:opacity-60", className)}>
      <Languages className="size-[17px] stroke-[1.75]" />
      <span>{next === "en" ? "English" : "العربية"}</span>
    </button>
  );
}
