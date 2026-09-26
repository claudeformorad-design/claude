import { Badge } from "@/components/ui/badge";
import type { InvoiceStatus } from "@/lib/supabase/database.types";

export function InvoiceStatusBadge({ status, labels }: { status: InvoiceStatus; labels: Record<InvoiceStatus, string> }) {
  const variant = status === "paid" ? "success" : status === "partially_paid" ? "warning" : "default";
  return <Badge variant={variant}>{labels[status]}</Badge>;
}
