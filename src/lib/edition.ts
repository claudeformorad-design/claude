/**
 * ما تعرضه هذه النسخة من نزيل في إدارة الصلاحيات.
 * النظام الكامل يعرض كل شيء؛ نسختا المحاسبة والحجوزات تخفيان أدوار وأقسام النسخة الأخرى.
 */
export const EDITION = {
  hiddenRoles: new Set<string>([]),
  hiddenModules: new Set<string>([]),
  hiddenQuickActions: new Set<string>([]),
};
