import { splitCode, splitDocCodes } from "@/lib/code-label";
import { plainText } from "@/lib/text";
import { cn } from "@/lib/utils";

/** شارة رمز هادئة بنفس حجم النص: رقم مستند أو رمز حساب منفصل عن الكلام العربي */
export function CodeTag({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("code-tag", className)}>{children}</span>;
}

/** تسمية «رمز اسم»: الاسم أولًا، والرمز باهتًا في الطرف المقابل */
export function CodeName({ label, className }: { label: string; className?: string }) {
  const { code, name } = splitCode(label);
  if (!code) return <span className={cn("truncate", className)}>{label}</span>;
  return (
    <span className={cn("flex min-w-0 items-center justify-between gap-3", className)}>
      <span className="truncate">{name}</span>
      <span className="num shrink-0 font-normal text-slate-400">{code}</span>
    </span>
  );
}

/** نص وصفي تُفصل فيه أرقام المستندات في شارات وتُعزل تواريخه، بعد تنظيفه من الشرطات والأقواس */
export function DocText({ text, className }: { text: string | null | undefined; className?: string }) {
  const parts = splitDocCodes(plainText(text));
  if (parts.every((p) => p.kind === "text")) return <span className={className}>{parts.map((p) => p.text).join("")}</span>;
  return (
    <span className={className}>
      {parts.map((p, i) => p.kind === "code" ? <CodeTag key={i}>{p.text}</CodeTag>
        : p.kind === "date" ? <span key={i} className="num">{p.text}</span>
        : <span key={i}>{p.text.replace(/\s*،\s*$/, " ").replace(/^\s*،\s*/, " ")}</span>)}
    </span>
  );
}
