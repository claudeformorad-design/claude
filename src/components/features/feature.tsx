"use client";
import { createContext, useContext } from "react";

/** ما أطفأه تخصيص النظام في الفندق الحالي، يُمرَّر من تخطيط الصفحات */
const FeaturesContext = createContext<ReadonlySet<string>>(new Set());

export function FeaturesProvider({ off, children }: { off: readonly string[]; children: React.ReactNode }) {
  return <FeaturesContext.Provider value={new Set(off)}>{children}</FeaturesContext.Provider>;
}

/** هل هذا الجزء أو الخانة أو الزر مفعّل؟ */
export const useFeature = (key: string) => !useContext(FeaturesContext).has(key);

/**
 * يخفي خانة أو زرًا أطفأه تخصيص النظام. الخانة تبقى في النموذج مخفية فتُرسل قيمتها الحالية كما هي
 * (لا تُمسح بيانات قديمة بإخفائها). المفعّل يُرسم كما هو بلا غلاف فلا يتأثر التخطيط.
 */
export function Feature({ k, children }: { k: string; children: React.ReactNode }) {
  const on = useFeature(k);
  return on ? <>{children}</> : <div hidden>{children}</div>;
}
