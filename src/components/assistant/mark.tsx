import { cn } from "@/lib/utils";

/**
 * علامة المساعد: قطرة حبر بلمعة هادئة، هوية خاصة بدل أيقونة الروبوت المألوفة.
 * تتنفس ببطء أثناء التفكير (thinking).
 */
export function AssistantMark({ className, thinking = false }: { className?: string; thinking?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("shrink-0", thinking && "assistant-mark-thinking", className)}>
      <path d="M12 2.6c3.9 4.3 7.2 8.2 7.2 11.8a7.2 7.2 0 1 1-14.4 0c0-3.6 3.3-7.5 7.2-11.8Z" fill="currentColor" />
      <path d="M8.9 11.6q-1.5 2.3-.75 5" fill="none" stroke="#fff" strokeOpacity=".7" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
