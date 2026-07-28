import { describe, expect, it } from "vitest";
import { findCatalogRule } from "./catalog-rules";

describe("catalog matching rules", () => {
  it.each([
    ["Waitstaff - 4hr function minimum", "Waitstaff"],
    ["Waiters - Full Shift", "Waitstaff"],
    ["Waitrons (full day)", "Waitstaff"],
    ["Runner - Full Day (4 staff)", "Event runner"],
    ["Event Runner (per hour)", "Event runner"],
    ["Table Runner - Hessian", "Hessian table runner"],
    ["Table Runners (hessian)", "Hessian table runner"],
    ["Trestle Tables", "1.8 m trestle table"],
    ["Truck Hire (8t) – Metro Trip x 3 trips", "8-ton truck metro trip"],
    ["20kVA Silent Diesel Generator (1 day)", "20 kVA silent generator"],
    ["Generator - 40kVA Silent (1 day)", "40 kVA silent generator"],
    ["Security Guard - Night Shift", "Night security officer"],
    ["Shuttle Service - 22 Seater (per trip)", "22-seat shuttle trip"]
  ])("maps %s conservatively", (description, expected) => {
    expect(findCatalogRule(description)?.name).toBe(expected);
  });

  it("does not merge an all-in package into a standalone stage", () => {
    expect(findCatalogRule("Stage & sound package - 6x4m stage, small PA")?.name)
      .toBe("Stage and sound all-in package");
  });

  it("does not merge a decor table runner into staffing", () => {
    expect(findCatalogRule("Table Runner - Hessian")?.category).toBe("Decor");
    expect(findCatalogRule("Table Runner - Hessian")?.name).not.toBe("Event runner");
  });
});
