import { describe, expect, it } from "vitest";
import { formatBytes } from "./format";

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [512, "512 B"],
    [1023, "1023 B"],
    [1024, "1.0 KB"],
    [1536, "1.5 KB"],
    [1024 * 1024 - 1, "1.0 MB"],
    [1024 * 1024, "1.0 MB"],
    [13 * 1024 * 1024, "13.0 MB"],
    [2.1 * 1024 ** 3, "2.1 GB"],
    [3 * 1024 ** 4, "3.0 TB"],
    [5000 * 1024 ** 4, "5000.0 TB"],
    [-5, "0 B"],
    [Number.NaN, "0 B"]
  ])("%d is %s", (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
});
