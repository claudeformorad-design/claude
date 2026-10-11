import { createHash, createHmac, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
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

  it("machine id comes from the operating system, not the network cards", () => {
    if (process.platform !== "linux" || !existsSync("/etc/machine-id")) return;
    const id = readFileSync("/etc/machine-id", "utf8").trim().toLowerCase();
    const hex = createHash("sha256").update(`hotelna|${id}`).digest("hex").slice(0, 16).toUpperCase();
    expect(lic.machineId()).toBe(hex.match(/.{4}/g)!.join("-"));
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

  it("check-in fixes a wrong device clock with the panel time", async () => {
    process.env.NAZEEL_PANEL_URL = "http://panel.test";
    const panelNow = Date.now() + 3 * 3600_000;
    const calls: { ts: string; sig: string; body: string }[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith("/api/v1/activate")) {
        return Response.json({ instance_id: "inst-1", secret: "s3cret", license: issue({ instance_id: "inst-1" }), notices: [] });
      }
      const h = init.headers as Record<string, string>;
      calls.push({ ts: h["x-timestamp"]!, sig: h["x-signature"]!, body: String(init.body) });
      if (Math.abs(Number(h["x-timestamp"]) - panelNow) > 10 * 60_000) return Response.json({ error: "clock", now: panelNow }, { status: 401 });
      return Response.json({ license: issue({ instance_id: "inst-1", sections: ["pms", "accounting", "laundry", "hr"] }), notices: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      expect(await lic.activateWithCode("NZL-AAAA-BBBB", null)).toEqual({ ok: true });
      expect(await lic.checkin(true)).toBe(true);
      expect(calls).toHaveLength(2);
      expect(calls[1]!.ts).toBe(String(panelNow));
      expect(calls[1]!.sig).toBe(createHmac("sha256", "s3cret").update(`${calls[1]!.ts}.${calls[1]!.body}`).digest("base64url"));
      const s = await lic.licenseStatus();
      expect(s).toMatchObject({ required: true, ok: true, lastError: null });
      if (s.required && s.ok) expect(s.license.sections).toContain("hr");
    } finally {
      vi.unstubAllGlobals();
      delete process.env.NAZEEL_PANEL_URL;
    }
  });
});
