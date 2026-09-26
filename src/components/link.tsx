import NextLink from "next/link";
import type { ComponentProps } from "react";

/**
 * رابط خفيف (مكوّن خادم): لا جلب مسبق تلقائي لكل الروابط الظاهرة (صفحات ديناميكية وجداول طويلة).
 * الجلب المسبق عند الوقوف على الرابط يتولاه مستمع واحد للصفحة كلها (HoverPrefetch) بدل
 * مكوّن تفاعلي لكل رابط — أخف بكثير في الصفحات ذات مئات الصفوف.
 */
export default function Link({ prefetch = false, ...props }: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={prefetch} {...props} />;
}
