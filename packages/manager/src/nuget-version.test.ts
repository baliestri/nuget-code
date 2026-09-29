import { describe, expect, it } from "vitest";
import {
  compareNuGetVersions,
  parseNuGetVersion,
  sameNuGetVersion,
} from "./nuget-version";
import {
  comparisonCases,
  invalidVersions,
  normalizationCases,
} from "./test/nuget-version-cases";

// Expected results verified against NuGet.Versioning 6.12.1, VersionRelease.
describe("NuGet version parsing", () => {
  it.each(normalizationCases)("normalizes %s to %s", (input, normalized) => {
    expect(parseNuGetVersion(input)?.normalized).toBe(normalized);
  });

  it("retains the four numeric components and release identifiers", () => {
    expect(parseNuGetVersion("01.02.003.4-RC.2+metadata")).toEqual({
      numbers: [1, 2, 3, 4],
      prerelease: ["RC", "2"],
      normalized: "1.2.3.4-RC.2",
    });
  });

  it.each(invalidVersions)("rejects invalid concrete version %j", (input) => {
    expect(parseNuGetVersion(input)).toBeUndefined();
  });
});

describe("NuGet version precedence", () => {
  it.each(comparisonCases)("compares %s against %s", (a, b, sign) => {
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
