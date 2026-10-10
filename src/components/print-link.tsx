import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** يفتح نسخة الطباعة للمستند في تبويب جديد، وتظهر نافذة الطباعة فيه مباشرة */
export function PrintLink({ href, label }: { href: string; label: string }) {
  return (
    <Button asChild variant="outline" className="print:hidden">
      <a href={href} target="_blank" rel="noopener"><Printer />{label}</a>
    </Button>
  );
}
