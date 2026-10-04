"use client";

import { useRef, useState, useTransition } from "react";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { actionErrorText, callAction } from "@/lib/action-error";
import { ar } from "@/i18n/dictionaries/ar";
import type { ImportCheck } from "@/services/import.service";
import { checkImportAction, runImportAction } from "./actions";

/**
 * خطوات الاستيراد: تنزيل القالب، رفع الملف وفحصه (لا يُحفظ شيء)، ثم الاستيراد إن خلا الملف من الأخطاء.
 */
export function ImportPanel({ kind, title, description, columns }: {
  kind: string; title: string; description: string; columns: { header: string; required: boolean; hint: string }[];
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<ImportCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [pending, start] = useTransition();

  const form = (f: File) => { const fd = new FormData(); fd.set("kind", kind); fd.set("file", f); return fd; };
  const pick = (f: File | undefined) => {
    if (!f) return;
    setFile(f); setCheck(null); setError(null); setDone(null);
    start(async () => {
      const r = await callAction(checkImportAction(form(f)));
      if (r.ok) setCheck(r.data); else setError(actionErrorText(ar.errors, r));
    });
  };
  const run = () => file && start(async () => {
    const r = await callAction(runImportAction(form(file)));
    if (r.ok) { setDone(r.data); setCheck(null); setFile(null); toast(`تم استيراد ${r.data} صف`); }
    else setError(actionErrorText(ar.errors, r));
  });
  const ready = check && !check.missingColumns.length && !check.errors.length && check.valid > 0;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>استيراد {title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <ol className="space-y-2 text-[15.5px] text-slate-600">
              <li><span className="num font-semibold text-ink">1</span> نزّل القالب واملأه، أو استخدم ملفك بنفس عناوين الأعمدة.</li>
              <li><span className="num font-semibold text-ink">2</span> ارفع الملف ليُفحص كل صف. لا يُحفظ شيء في هذه الخطوة.</li>
              <li><span className="num font-semibold text-ink">3</span> إن خلا الملف من الأخطاء استورده دفعة واحدة.</li>
            </ol>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline"><a href={`/api/import-template/${kind}`} download><Download />تنزيل القالب</a></Button>
              <Button type="button" onClick={() => input.current?.click()} loading={pending && !check}><Upload />رفع ملف Excel</Button>
              <input ref={input} type="file" accept=".xlsx,.csv" className="hidden" aria-label="ملف الاستيراد"
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; pick(f); }} />
            </div>
            {file && <p className="flex items-center gap-2 text-[15px] text-slate-600"><FileSpreadsheet className="size-4" /><span dir="ltr">{file.name}</span></p>}
            {error && <Alert variant="destructive">{error}</Alert>}
            {done !== null && <Alert variant="success">تم استيراد <span className="num">{done}</span> صف بنجاح.</Alert>}
          </CardContent>
        </Card>

        {check && (
          <Card>
            <CardHeader>
              <CardTitle className="justify-between">
                <span>نتيجة الفحص</span>
                <span className="flex gap-2">
                  <Badge variant="secondary">الصفوف <span className="num">{check.total}</span></Badge>
                  <Badge variant="success">صالحة <span className="num">{check.valid}</span></Badge>
                  {check.errors.length > 0 && <Badge variant="destructive">أخطاء <span className="num">{check.errors.length}</span></Badge>}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {check.missingColumns.length > 0 && (
                <Alert variant="destructive">أعمدة مطلوبة غير موجودة في الملف: {check.missingColumns.join("، ")}</Alert>
              )}
              {check.ignoredColumns.length > 0 && (
                <Alert>أعمدة لن تُستورد لأنها ليست في القالب: {check.ignoredColumns.join("، ")}</Alert>
              )}
              {check.total === 0 && !check.missingColumns.length && <Alert variant="warning">الملف لا يحتوي على صفوف بيانات.</Alert>}
              {check.errors.length > 0 && (
                <div className="overflow-hidden rounded-lg border border-line">
                  <Table>
                    <TableHeader><TableRow><TableHead className="w-24">الصف</TableHead><TableHead>المشكلة</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {check.errors.map((e, i) => (
                        <TableRow key={i}><TableCell className="num">{e.line}</TableCell><TableCell className="text-urgent">{e.message}</TableCell></TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {check.preview.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[15px] text-slate-500">أول الصفوف الصالحة</p>
                  <div className="overflow-x-auto rounded-lg border border-line">
                    <Table>
                      <TableHeader><TableRow><TableHead>الصف</TableHead>{columns.map((c) => <TableHead key={c.header}>{c.header}</TableHead>)}</TableRow></TableHeader>
                      <TableBody>
                        {check.preview.map((r) => (
                          <TableRow key={r.line}><TableCell className="num">{r.line}</TableCell>{r.cells.map((c, i) => <TableCell key={i}>{c}</TableCell>)}</TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
                <Button onClick={run} disabled={!ready} loading={pending && Boolean(check)}>استيراد <span className="num">{check.valid}</span> صف</Button>
                {!ready && check.total > 0 && <p className="text-[15px] text-slate-500">صحّح الأخطاء في الملف ثم ارفعه مرة أخرى. لا يُستورد شيء ما دام فيه خطأ.</p>}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <Card className="self-start">
        <CardHeader><CardTitle>أعمدة الملف</CardTitle><CardDescription>المطلوب منها لا يُترك فارغًا.</CardDescription></CardHeader>
        <CardContent>
          <ul className="divide-y divide-line">
            {columns.map((c) => (
              <li key={c.header} className="py-2.5">
                <p className="flex items-center justify-between gap-2 text-[15.5px] font-medium text-ink">{c.header}{c.required && <Badge variant="warning">مطلوب</Badge>}</p>
                {c.hint && <p className="text-[14px] text-slate-500">{c.hint}</p>}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
