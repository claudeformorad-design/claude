import { describe, expect, it } from "vitest";
import { featureTree, flatten } from "./registry";
import { featureState, maskedPermissions, underHref } from "./state";

const base = { enabled_modules: ["accounting", "pms"], blocked_sections: [] as string[], disabled_features: [] as string[] };

describe("feature toggles", () => {
  it("everything is on by default", () => {
    const s = featureState(base);
    expect(s.off.size).toBe(0);
    expect(s.hiddenHrefs).toEqual([]);
  });

  it("a blocked section hides its pages and drops its permissions in the owner tier only", () => {
    const s = { ...base, blocked_sections: ["laundry"] };
    expect(featureState(s).hiddenHrefs).toEqual(["/laundry"]);
    expect(maskedPermissions(s, "section")).toEqual(["laundry.manage"]);
    expect(maskedPermissions(s, "feature")).toEqual([]);
  });

  it("turning off a core module turns off everything under it", () => {
    const s = featureState({ ...base, enabled_modules: ["accounting"] });
    expect(s.off.has("pms")).toBe(true);
    expect(s.off.has("pms.cashier")).toBe(true);
    expect(s.off.has("reservations.group")).toBe(true);
    expect(s.hiddenHrefs).toContain("/front-desk");
    expect(maskedPermissions({ ...base, enabled_modules: ["accounting"] }, "section")).toContain("cashier.shifts");
  });

  it("parts, fields and buttons belong to the manager tier", () => {
    const s = { ...base, disabled_features: ["pms.cashier", "folio.void", "customers.tax_number"] };
    const st = featureState(s);
    expect(st.off.has("folio.void")).toBe(true);
    expect(st.hiddenHrefs).toEqual(["/cashier"]);
    expect(maskedPermissions(s, "feature")).toEqual(["cashier.shifts", "cashier.shifts.manage", "folio.void"]);
    expect(maskedPermissions(s, "section")).toEqual([]);
  });

  it("locked items never turn off even if stored", () => {
    const st = featureState({ ...base, disabled_features: ["pms.reservations", "general.dashboard"], blocked_sections: ["general"] });
    expect(st.off.has("pms.reservations")).toBe(false);
    expect(st.off.has("general.dashboard")).toBe(false);
    expect(st.hiddenHrefs).toEqual([]);
  });

  it("keys are unique and never mask hotel or user administration", () => {
    const all = flatten(featureTree(new Proxy({}, { get: (_, k) => String(k) }) as never)).map((x) => x.node);
    expect(new Set(all.map((n) => n.key)).size).toBe(all.length);
    const perms = all.flatMap((n) => n.permissions ?? []);
    expect(perms).not.toContain("settings.hotel.manage");
    expect(perms).not.toContain("settings.users.manage");
  });

  it("href matching follows the menu rule", () => {
    expect(underHref("/hr/attendance", "/hr")).toBe(true);
    expect(underHref("/hrx", "/hr")).toBe(false);
    expect(underHref("/rate-plans", "/rates")).toBe(false);
    expect(underHref("/settings", "/")).toBe(false);
  });
});
