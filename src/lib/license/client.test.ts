import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
process.env.NAZEEL_LICENSE_PUBLIC_KEY = publicKey.export({ type: "spki", format: "der" }).toString("base64");
process.env.NAZEEL_REQUIRE_LICENSE = "1";
process.env.LOCAL_DB_DIR = path.join(mkdtempSync(path.join(tmpdir(), "nazeel-lic-")), "pglite");

const lic = await import("./client");

const issue = (over: Record<string, unknown> = {}, key = privateKey) => {
  const payload = { v: 1, kind: "nazeel-license", hotel_id: "h1", hotel_name: "فندق السلام", instance_id: null, machine: lic.machineId(),
    sections: ["pms", "accounting", "laundry"], status: "active", updates: "forever", issued_at: new Date().toISOString(), ...over };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(null, Buffer.from(body), key).toString("base64url")}`;
};

describe("license client", () => {
  beforeAll(() => { expect(lic.licenseRequired()).toBe(true); });

  it("verifies only licenses signed by the panel key", () => {
    expect(lic.verifyLicense(issue())?.hotel_name).toBe("فندق السلام");
    const other = generateKeyPairSync("ed25519").privateKey;
    expect(lic.verifyLicense(issue({}, other))).toBeNull();
    const [body, sig] = issue().split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body!, "base64url").toString()), sections: ["pms", "accounting", "laundry", "hr"] })).toString("base64url");
    expect(lic.verifyLicense(`${forged}.${sig}`)).toBeNull();
    expect(lic.verifyLicense("garbage")).toBeNull();
  });

  it("machine id is stable and readable", () => {
    expect(lic.machineId()).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
    expect(lic.machineId()).toBe(lic.machineId());
  });

  it("starts unactivated, refuses keys for another machine, accepts its own", async () => {
    expect(await lic.licenseStatus()).toMatchObject({ required: true, ok: false, reason: "not_activated" });
    expect(await lic.activateWithKey(issue({ machine: "AAAA-BBBB-CCCC-DDDD" }))).toEqual({ ok: false, error: "other_machine" });
    expect(await lic.activateWithKey(issue({ instance_id: "x" }))).toEqual({ ok: false, error: "invalid_key" });
    expect(await lic.activateWithKey(issue({ status: "suspended" }))).toEqual({ ok: false, error: "suspended" });
    expect(await lic.activateWithKey(issue())).toEqual({ ok: true });
    const s = await lic.licenseStatus();
    expect(s).toMatchObject({ required: true, ok: true, linked: false });
    if (s.required && s.ok) expect(s.license.sections).toEqual(["pms", "accounting", "laundry"]);
  });

  it("licensed settings turn off what was not bought", () => {
    const license = lic.verifyLicense(issue({ sections: ["accounting", "laundry"] }))!;
    const all = ["pms", "pos", "laundry", "hr", "accounting", "assistant", "general"];
    const out = lic.licensedSettings({ enabled_modules: ["accounting", "pms"], blocked_sections: ["pos"], disabled_features: [] }, license, all);
    expect(out.enabled_modules).toEqual(["accounting"]);
    expect([...out.blocked_sections].sort()).toEqual(["assistant", "hr", "pos"]);
    // الفندق أطفأ المحاسبة بنفسه وهي كل ما اشتراه من الأساسيين: تبقى
    expect(lic.licensedSettings({ enabled_modules: ["pms"], blocked_sections: [], disabled_features: [] }, license, all).enabled_modules).toEqual(["accounting"]);
  });
});
