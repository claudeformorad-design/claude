import { describe, expect, it } from "vitest";
import { searchTerm } from "./search-term";

describe("searchTerm", () => {
  it("removes filter syntax so input cannot add conditions", () => {
    expect(searchTerm("a,hotel_id.neq.x")).toBe("a hotel_id.neq.x");
    expect(searchTerm('x),or(id.not.is.null')).toBe("x or id.not.is.null");
    expect(searchTerm('"%*\\:')).toBe("");
  });
  it("keeps normal Arabic and English text", () => {
    expect(searchTerm("  سالم   أحمد ")).toBe("سالم أحمد");
    expect(searchTerm("RSV-0012")).toBe("RSV-0012");
  });
  it("limits length and handles empty input", () => {
    expect(searchTerm("a".repeat(500))).toHaveLength(100);
    expect(searchTerm(undefined)).toBe("");
  });
});
