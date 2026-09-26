"use client";

import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { useRef, type ComponentProps } from "react";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";

/**
 * رابط بجلب مسبق «عند النية» فقط: لا جلب تلقائي لكل الروابط الظاهرة (صفحات النظام ديناميكية
 * وتستعلم قاعدة البيانات، وجداولها قد تحوي مئات الروابط)، بل تُجلب الصفحة كاملة ببياناتها
 * عند الوقوف على الرابط لحظة (أو لمسه)، فتفتح فور النقر.
 * كل رابط يُجلب مرة كل 20 ثانية كحد أقصى، والبيانات المجلوبة تبقى صالحة 30 ثانية (next.config).
 */
const recent = new Map<string, number>();

export default function Link({ prefetch = false, onMouseEnter, onMouseLeave, onTouchStart, onFocus, ...props }: ComponentProps<typeof NextLink>) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const href = typeof props.href === "string" ? props.href : null;

  const warm = () => {
    if (!href || prefetch !== false || !href.startsWith("/") || href.startsWith("/api/")) return;
    const now = Date.now();
    if ((recent.get(href) ?? 0) > now - 20_000) return;
    recent.set(href, now);
    router.prefetch(href, { kind: PrefetchKind.FULL });
  };
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  return (
    <NextLink
      prefetch={prefetch}
      onMouseEnter={(e) => { onMouseEnter?.(e); cancel(); timer.current = setTimeout(warm, 70); }}
      onMouseLeave={(e) => { onMouseLeave?.(e); cancel(); }}
      onTouchStart={(e) => { onTouchStart?.(e); warm(); }}
      onFocus={(e) => { onFocus?.(e); warm(); }}
      {...props}
    />
  );
}
