import { describe, expect, it } from "vitest";
import { parseSouthAfricanDate } from "./date";

describe("South African date parsing", () => {
  it.each([
    ["03/08/2025", "2025-08-03"],
    ["2025/09/10", "2025-09-10"],
    ["22-09-2025", "2025-09-22"],
    ["26 Sep 2025", "2025-09-26"],
    ["26 Sept 2025", "2025-09-26"],
    ["26th September, 2025", "2025-09-26"],
    ["10 October 2025", "2025-10-10"],
    ["1 March 2026", "2026-03-01"]
  ])("parses %s", (source, expected) => {
    expect(parseSouthAfricanDate(source)).toBe(expected);
  });
});
