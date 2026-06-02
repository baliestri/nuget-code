// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import {
  formatBytes,
  formatDate,
  formatLogTimestamp,
  yesNo,
} from "./format.js";

describe("format helpers", () => {
  it("formats booleans, sizes, and dates", () => {
    expect(yesNo(true)).toBe("Yes");
    expect(yesNo(false)).toBe("No");
    expect(formatBytes(undefined)).toBe("Not calculated");
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 ** 2 * 2.5)).toBe("2.5 MB");
    expect(formatDate(undefined)).toBeUndefined();
    expect(formatDate("not-a-date")).toBe("not-a-date");
    expect(formatDate("2026-01-01T00:00:00.000Z")).toEqual(
      new Date("2026-01-01T00:00:00.000Z").toLocaleString(),
    );
  });

  it("formats log timestamps using navigator language", () => {
    vi.stubGlobal("navigator", { language: "en-US" });
    expect(formatLogTimestamp("2026-01-02T03:04:05.000Z")).toContain("2026");
    vi.unstubAllGlobals();
  });
});
