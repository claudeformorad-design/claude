"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";

/**
 * جلب مسبق «عند النية» لكل روابط النظام بمستمع واحد: عند الوقوف على رابط داخلي 60ms
 * (أو لمسه أو التركيز عليه) تُجلب الصفحة كاملة ببياناتها، فتفتح فور النقر.
 * كل رابط يُجلب مرة كل 20 ثانية كحد أقصى؛ والبيانات المجلوبة صالحة 30 ثانية وتُبطل عند أي حفظ.
 * روابط الصفحة نفسها (معاملات البحث فقط) مستثناة.
 */
export function HoverPrefetch() {
  const router = useRouter();
  useEffect(() => {
    const recent = new Map<string, number>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const hrefOf = (t: EventTarget | null) => {
      const a = t instanceof Element ? t.closest("a[href]") : null;
      const href = a?.getAttribute("href");
      if (!href || !href.startsWith("/") || href.startsWith("/api/") || a?.getAttribute("target") === "_blank") return null;
      // روابط نفس الصفحة (نوافذ ?new و?edit والتبويبات والفلاتر) لا تُجلب مسبقًا: الجلب المسبق الكامل
      // لتغيير معاملات البحث فقط يُنتج صفحة فارغة في Next 16، وهي تفتح فورًا دونه
      if (href.split("?")[0] === window.location.pathname) return null;
      return href;
    };
    const warm = (href: string) => {
      const now = Date.now();
      if ((recent.get(href) ?? 0) > now - 20_000) return;
      recent.set(href, now);
      router.prefetch(href, { kind: PrefetchKind.FULL });
    };
    const onOver = (e: Event) => {
      const href = hrefOf(e.target);
      if (timer) clearTimeout(timer);
      if (href) timer = setTimeout(() => warm(href), 60);
    };
    const onNow = (e: Event) => { const href = hrefOf(e.target); if (href) warm(href); };
    document.addEventListener("pointerover", onOver, { passive: true });
    document.addEventListener("touchstart", onNow, { passive: true });
    document.addEventListener("focusin", onNow);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("touchstart", onNow);
      document.removeEventListener("focusin", onNow);
    };
  }, [router]);
  return null;
}
