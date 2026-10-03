"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * علامة المساعد: نجمة ثمانية من مربعين متعامدين، من الزخرفة الهندسية العربية، تتوسطها لمعة رباعية منحوتة فيها.
 * أثناء التفكير تدور النجمة ربع دورة بهدوء ثم تستقر، ولأن شكلها متناظر تبدو الحركة متصلة بلا قفزة.
 */
const STAR = "M12 1.4 15.1 4.5h4.4v4.4l3.1 3.1-3.1 3.1v4.4h-4.4L12 22.6l-3.1-3.1H4.5v-4.4L1.4 12l3.1-3.1V4.5h4.4Z";
const SPARK = "M12 6.3q.6 5.1 5.7 5.7-5.1.6-5.7 5.7-.6-5.1-5.7-5.7 5.1-.6 5.7-5.7Z";

export function AssistantMark({ className, thinking = false }: { className?: string; thinking?: boolean }) {
  const id = `am${React.useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("shrink-0", className)}>
      <defs>
        <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <rect width="24" height="24" fill="#fff" />
          <path d={SPARK} fill="#000" />
        </mask>
      </defs>
      <g className={cn(thinking && "assistant-mark-thinking")}>
        <path d={STAR} fill="currentColor" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" mask={`url(#${id})`} />
      </g>
    </svg>
  );
}
