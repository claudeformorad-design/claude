import { Badge } from "@/components/ui/badge";
import type { JournalStatus } from "@/lib/supabase/database.types";

export function StatusBadge({
  status,
  reversed,
  labels,
}: {
  status: JournalStatus;
  reversed: boolean;
  labels: { draft: string; posted: string; reversed: string };
}) {
  if (reversed) return <Badge variant="warning">{labels.reversed}</Badge>;
  return status === "posted" ? <Badge variant="success">{labels.posted}</Badge> : <Badge variant="secondary">{labels.draft}</Badge>;
}
