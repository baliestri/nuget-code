import { describe, expect, it } from "vitest";
import {
  compareNuGetVersions,
  parseNuGetVersion,
  sameNuGetVersion,
} from "./nuget-version";

// Expected results verified against NuGet.Versioning 6.12.1, VersionRelease.
describe("NuGet version parsing", () => {
  it.each([
    ["1", "1.0.0"],
    ["1.2", "1.2.0"],
    ["01.002.0003.0", "1.2.3"],
    ["1.2.3.4", "1.2.3.4"],
    [" 1 . 2 . 3 ", "1.2.3"],
    ["1.0.0\u0085", "1.0.0"],
    ["2147483647.0", "2147483647.0.0"],
    ["1.0.0+build-meta.01", "1.0.0"],
    ["1.0.0-ALPHA+build", "1.0.0-ALPHA"],
    ["1.0.0-0A", "1.0.0-0A"],
    ["1.0.0--01", "1.0.0--01"],
    ["1.0.0-999999999999999999999999", "1.0.0-999999999999999999999999"],
  ])("normalizes %s to %s", (input, normalized) => {
    expect(parseNuGetVersion(input)?.normalized).toBe(normalized);
  });

  it("retains the four numeric components and release identifiers", () => {
    expect(parseNuGetVersion("01.02.003.4-RC.2+metadata")).toEqual({
      numbers: [1, 2, 3, 4],
      prerelease: ["RC", "2"],
      normalized: "1.2.3.4-RC.2",
    });
  });

  it.each([
    "",
    " ",
    "v1.0.0",
    "[1.0,2.0)",
    "1.*",
    "1.",
    "1..2",
    "1.2.3.4.5",
    "-1.0",
    "+1.0",
    "1e2.0",
    "1 2.0",
    "2147483648.0",
    "1.0.0-",
    "1.0.0+",
    "1.0.0-alpha+",
    "1.0.0-01",
    "1.0.0-alpha.01",
    "1.0.0-a..b",
    "1.0.0+a..b",
    "1.0.0-a_b",
    "1.0.0+a_b",
    "1.0.0+meta+more",
    "1.0.0-α",
    "\ufeff1.0.0",
  ])("rejects invalid concrete version %j", (input) => {
    expect(parseNuGetVersion(input)).toBeUndefined();
  });
});

describe("NuGet version precedence", () => {
  const cases: [string, string, number][] = [
    ["1.0.10", "1.0.2", 1],
    ["1.0.0", "1.0.0-beta", 1],
    ["1.0", "1.0.0.0", 0],
    ["1.0.0.1", "1.0.0", 1],
    ["1.0.0.1-alpha", "1.0.0", 1],
    ["1.0.0+abc", "1.0.0+xyz", 0],
    ["1.0.0-ALPHA", "1.0.0-alpha", 0],
    ["1.0.0-beta.2", "1.0.0-beta.10", -1],
    ["1.0.0-beta", "1.0.0-beta.1", -1],
    ["1.0.0-1", "1.0.0-alpha", -1],
    ["1.0.0--01", "1.0.0--1", 0],
    ["1.0.0--1", "1.0.0-0", -1],
    ["1.0.0-9999999999", "1.0.0-10000000000", 1],
    ["1.0.0-2147483648", "1.0.0-2147483647", 1],
    ["1.0.0--2147483648", "1.0.0-0", -1],
  ];

  it.each(cases)("compares %s against %s", (a, b, sign) => {
    expect(Math.sign(compareNuGetVersions(a, b))).toBe(sign);
    expect(compareNuGetVersions(b, a) + compareNuGetVersions(a, b)).toBe(0);
    expect(sameNuGetVersion(a, b)).toBe(sign === 0);
  });

  it("orders the standard prerelease progression", () => {
    const ordered = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
    ];
    expect([...ordered].reverse().sort(compareNuGetVersions)).toEqual(ordered);
  });

  it("never treats invalid versions as comparable, including identical input", () => {
    expect(() => compareNuGetVersions("[1,2)", "1.5")).toThrow(RangeError);
    expect(() => compareNuGetVersions("1.5", "*")).toThrow(RangeError);
    expect(() => sameNuGetVersion("invalid", "invalid")).toThrow(RangeError);
  });
});
