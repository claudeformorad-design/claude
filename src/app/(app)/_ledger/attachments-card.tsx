import { tr } from "@/i18n/tr";
import { Card } from "@/components/ui/card";
import type { AppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { type AttachmentEntity, listAttachments } from "@/services/attachments.service";
import { FileImage, FileText, Paperclip } from "lucide-react";
import { AttachmentUpload, DeleteAttachmentButton } from "./forms";

const WRITE: Record<AttachmentEntity, (ctx: AppContext) => boolean> = {
  journal_entry: (c) => c.can(PERMISSIONS.journalCreate),
  payment: (c) => c.can(PERMISSIONS.paymentsReceipt) || c.can(PERMISSIONS.paymentsDisbursement),
  vendor_bill: (c) => c.can(PERMISSIONS.billsCreate),
  invoice: (c) => c.can(PERMISSIONS.invoicesCreate),
};

const size = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** مرفقات المستند: صور الفواتير والإيصالات والعقود */
export async function AttachmentsCard({ ctx, entity, entityId, path, errors }: {
  ctx: AppContext; entity: AttachmentEntity; entityId: string; path: string; errors: Record<string, string>;
}) {
  const files = await listAttachments(ctx.supabase, ctx.hotel.id, entity, entityId);
  const canWrite = WRITE[entity](ctx);
  if (!files.length && !canWrite) return null;
  return (
    <Card className="space-y-3 p-4 print:hidden">
      <p className="flex items-center gap-2 font-semibold"><Paperclip className="size-4 text-slate-500" />{tr("المرفقات")}</p>
      {files.length === 0 ? <p className="text-[14px] text-slate-500">{tr("لا مرفقات. أرفق صورة الفاتورة أو الإيصال أو العقد.")}</p> : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {files.map((f) => {
            const Icon = f.mime_type.startsWith("image/") ? FileImage : FileText;
            return (
              <li key={f.id} className="flex items-center gap-3 px-3 py-2">
                <Icon className="size-4 shrink-0 text-slate-500" />
                <a href={`/api/attachments/${f.id}`} target="_blank" rel="noopener" className="min-w-0 flex-1 truncate text-action">{f.file_name}</a>
                <span className="num text-[13px] text-slate-500">{size(f.size_bytes)}</span>
                <span className="num text-[13px] text-slate-500">{f.created_at.slice(0, 10)}</span>
                {canWrite && <DeleteAttachmentButton id={f.id} path={path} errors={errors} />}
              </li>
            );
          })}
        </ul>
      )}
      {canWrite && files.length < 20 && <AttachmentUpload entityType={entity} entityId={entityId} errors={errors} />}
    </Card>
  );
}
