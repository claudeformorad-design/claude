import { describe, expect, it } from "vitest";
import { registerServerLocale } from "@/i18n/tr";
import { buildCatalog, catalogHash } from "./catalog";

const perms = [
  { code: "invoices.write_off", module: "invoices", name_ar: "إعدام الديون المعدومة", product: "core" },
  { code: "settings.users.manage", module: "settings", name_ar: "إدارة المستخدمين والأدوار", product: "core" },
  { code: "commissions.manage", module: "payables", name_ar: "عمولات وكلاء الحجز", product: "core" },
];

describe("panel catalog", () => {
  it("is always Arabic, even inside an English request, and its hash is stable", () => {
    registerServerLocale(() => "en");
    try {
      const c = buildCatalog(perms);
      expect(c.tree.find((n) => n.key === "pms")?.label).toBe("الحجوزات والاستقبال");
      expect(c.permission_groups.find((g) => g.key === "invoices")?.label).toBe("الفواتير");
      // إدارة المستخدمين لا تُوقف، والصلاحية بلا مجموعة معروفة تذهب لـ«أخرى»
      expect(c.permissions.find((p) => p.code === "settings.users.manage")?.locked).toBe(true);
      expect(c.permissions.find((p) => p.code === "commissions.manage")?.group).toBe("other");
      expect(catalogHash(c)).toBe(catalogHash(buildCatalog(perms)));
      expect(catalogHash(c)).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      registerServerLocale(() => "ar");
    }
  });
});
