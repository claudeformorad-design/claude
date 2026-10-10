import { tr } from "@/i18n/tr";
import { forbidden } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { requireAppContext } from "@/lib/auth/context";
import { availableImports } from "@/services/import.service";
import { ImportPanel } from "./import-client";

/**
 * استيراد البيانات من Excel عند بدء تشغيل النظام في الفندق: الغرف، النزلاء، العملاء، الأصناف، الموظفون.
 * يظهر لكل مستخدم ما يملك صلاحية إضافته فقط.
 */
export default async function ImportPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const ctx = await requireAppContext();
  const defs = availableImports(ctx);
  if (!defs.length) forbidden();
  const sp = await searchParams;
  const current = defs.find((d) => d.kind === sp.kind) ?? defs[0]!;
  return (
    <>
      <PageHeader title={tr("استيراد البيانات")} />
      <FilterTabs className="mb-6" active={current.kind} items={defs.map((d) => ({ key: d.kind, href: `/settings/import?kind=${d.kind}`, label: tr(d.title) }))} />
      <ImportPanel key={current.kind} kind={current.kind} title={tr(current.title)} description={tr(current.description)}
        columns={current.columns.map((c) => ({ header: tr(c.header), required: Boolean(c.required), hint: c.hint ? tr(c.hint) : "" }))} />
    </>
  );
}
