import NextLink from "next/link";
import type { ComponentProps } from "react";

/**
 * رابط بدون جلب مسبق تلقائي افتراضيًا: صفحات النظام ديناميكية وتستعلم قاعدة البيانات،
 * والجلب المسبق لكل روابط الشريط الجانبي والجداول كان يولّد عشرات الطلبات مع كل صفحة.
 */
export default function Link({ prefetch = false, ...props }: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={prefetch} {...props} />;
}
