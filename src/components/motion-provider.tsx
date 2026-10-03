"use client";

import { LazyMotion } from "motion/react";

// ميزات الحركة (بما فيها layoutId) تُحمَّل بعد ظهور الصفحة بدل أن تُحزم مع كل صفحة
const loadFeatures = () => import("./motion-features").then((m) => m.default);

/** يوفّر الحركات لمكونات m.* في النظام كله بتحميل كسول (strict يمنع استخدام motion.* الثقيل خطأً) */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <LazyMotion features={loadFeatures} strict>{children}</LazyMotion>;
}
