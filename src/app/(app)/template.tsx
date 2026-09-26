"use client";

import { motion } from "motion/react";

/** انتقال الصفحات: ظهور ناعم مع انزلاق وتلاشي ضبابي عند كل تنقّل */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18, filter: "blur(8px)" }}
      // transitionEnd يزيل الفلتر بعد الحركة حتى لا يصبح هذا العنصر حاويًا للعناصر الثابتة (fixed)
      animate={{ opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none", transform: "none" } }}
      transition={{ type: "spring", stiffness: 210, damping: 28, mass: 0.9 }}
    >
      {children}
    </motion.div>
  );
}
