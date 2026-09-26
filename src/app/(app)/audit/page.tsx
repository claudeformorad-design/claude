import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getI18n } from "@/i18n/server";
import { formatDateTime } from "@/lib/accounting/fiscal";

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ table?: string; page?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.auditView);
  const { t } = await getI18n();
  const sp = await searchParams;
  const page = Math.max(0, Number(sp.page ?? 0) || 0);
  let q = ctx.supabase.from("audit_log_view").select("*").eq("hotel_id", ctx.hotel.id).order("occurred_at", { ascending: false }).range(page * 100, page * 100 + 99);
  if (sp.table) q = q.eq("table_name", sp.table.trim());
  const { data } = await q;
  const a = t.admin;
  return (
    <>
      <PageHeader title={t.nav.audit} description={a.auditSubtitle} />
      <form className="toolbar">
        <Input name="table" defaultValue={sp.table} placeholder={a.table} dir="ltr" className="w-60" />
        <Button type="submit" variant="outline">{t.common.apply}</Button>
      </form>
      <Card className="overflow-hidden">
        <Table>
          <TableHeader><TableRow>
            <TableHead>{t.common.date}</TableHead><TableHead>{a.actor}</TableHead><TableHead>{a.table}</TableHead><TableHead>{a.action}</TableHead><TableHead>{a.changed}</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {(data ?? []).map((r) => (
              <TableRow key={r.id}>
                <TableCell className="num whitespace-nowrap">{formatDateTime(r.occurred_at, ctx.hotel.timezone, true)}</TableCell>
                <TableCell>{r.actor_name || "—"}</TableCell>
                <TableCell className="num">{r.table_name}</TableCell>
                <TableCell><Badge variant={r.action === "DELETE" ? "destructive" : r.action === "INSERT" ? "success" : "outline"}>{r.action}</Badge></TableCell>
                <TableCell className="max-w-md">
                  {r.action === "UPDATE" ? (
                    <details><summary className="cursor-pointer num">{(r.changed_fields ?? []).join(", ")}</summary>
                      <pre dir="ltr" className="mt-1 max-h-48 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(
                        Object.fromEntries((r.changed_fields ?? []).map((f) => [f, { from: (r.old_data as Record<string, unknown>)?.[f], to: (r.new_data as Record<string, unknown>)?.[f] }])), null, 1)}</pre>
                    </details>
                  ) : <span className="num text-xs text-muted-foreground">{r.record_id}</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <div className="mt-4 flex gap-2">
        {page > 0 && <Button asChild variant="outline"><a href={`?page=${page - 1}${sp.table ? `&table=${sp.table}` : ""}`}>←</a></Button>}
        {(data ?? []).length === 100 && <Button asChild variant="outline"><a href={`?page=${page + 1}${sp.table ? `&table=${sp.table}` : ""}`}>→</a></Button>}
      </div>
    </>
  );
}
