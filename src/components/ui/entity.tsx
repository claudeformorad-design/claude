import Link from "@/components/link";
import { cn } from "@/lib/utils";

const TINTS = [
  "bg-accent1-tint text-sky",
  "bg-accent2-tint text-ink",
  "bg-success-tint text-success",
  "bg-[#ebe4f6] text-[#5f3f99]",
  "bg-urgent-tint text-urgent",
];

/** لون ثابت لكل اسم (نفس الاسم = نفس اللون دائمًا) */
function tintOf(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TINTS[h % TINTS.length]!;
}

function initials(name: string): string {
  const words = name.replace(/[()«»"]/g, "").trim().split(/\s+/).filter(Boolean);
  const w = words.filter((x) => !["شركة", "مؤسسة", "مجموعة", "وفد", "فريق", "ال"].includes(x));
  const pick = (w.length ? w : words).slice(0, 2);
  return pick.map((x) => x.replace(/^ال/, "")[0] ?? "").join("") || "؟";
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md text-[15.5px] font-semibold", tintOf(name), className)} aria-hidden>
      {initials(name)}
    </span>
  );
}

/** خلية اسم بصورة رمزية ملونة وسطر فرعي (عميل، مورد، نزيل...) */
export function EntityCell({ name, sub, href }: { name: string; sub?: React.ReactNode; href?: string }) {
  const body = (
    <span className="flex min-w-0 items-center gap-3">
      <Avatar name={name} />
      <span className="min-w-0 leading-tight">
        <span className="block truncate font-medium text-ink transition-colors group-hover:text-action">{name}</span>
        {sub && <span className="block truncate text-[15.5px] text-slate-500">{sub}</span>}
      </span>
    </span>
  );
  return href ? <Link href={href} className="group block">{body}</Link> : body;
}
