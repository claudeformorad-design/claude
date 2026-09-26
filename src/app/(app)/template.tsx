/**
 * انتقال الصفحات: يُعاد تركيب هذا المكوّن مع كل تنقّل، فتُعاد حركة CSS تلقائيًا.
 * الحركة CSS خالصة (لا تعتمد على JavaScript) حتى يبقى المحتوى ظاهرًا دائمًا،
 * وأقسام الصفحة تظهر متتابعة (stagger).
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter stagger">{children}</div>;
}
