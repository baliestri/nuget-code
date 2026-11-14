import type { AdvisoryInfo, PackagesVulnerabilitiesResult } from "@nuget-code/protocol";
import { describe, expect, it } from "vitest";
import { advisoriesFor, advisoryIndex, advisoryName, highestSeverity, isSevere, shieldOf } from "./vulnerabilities";

const LOW: AdvisoryInfo = { severity: "low", url: "https://github.com/advisories/GHSA-low" };
const HIGH: AdvisoryInfo = { severity: "high", url: "https://github.com/advisories/GHSA-high" };
const CRITICAL: AdvisoryInfo = { severity: "critical", url: "https://github.com/advisories/GHSA-critical" };

const RESULT: PackagesVulnerabilitiesResult = {
  packages: [
    { id: "Alpha", version: "1.0.0", advisories: [HIGH, LOW] },
    { id: "Alpha", version: "1.5.0", advisories: [LOW, CRITICAL] },
    { id: "Beta", version: "2.0.0-RC.1", advisories: [LOW] }
  ],
  failures: []
};

describe("advisoriesFor", () => {
  const index = advisoryIndex(RESULT);

  it("finds the advisories of a version, whatever the case of the id and the version", () => {
    expect(advisoriesFor(index, "ALPHA", ["1.0.0"])).toEqual([HIGH, LOW]);
    expect(advisoriesFor(index, "beta", ["2.0.0-rc.1"])).toEqual([LOW]);
  });

  it("gathers several versions, each advisory once, the worst first", () => {
    expect(advisoriesFor(index, "Alpha", ["1.0.0", "1.5.0"])).toEqual([CRITICAL, HIGH, LOW]);
  });

  it("has nothing for a version without advisories, or for no answer at all", () => {
    expect(advisoriesFor(index, "Alpha", ["2.0.0"])).toEqual([]);
    expect(advisoriesFor(advisoryIndex(undefined), "Alpha", ["1.0.0"])).toEqual([]);
  });
});

describe("severity", () => {
  it("the highest is the worst, and nothing has none", () => {
    expect(highestSeverity([LOW, CRITICAL, HIGH])).toBe("critical");
    expect(highestSeverity([{ severity: "unknown", url: "x" }, LOW])).toBe("low");
    expect(highestSeverity([])).toBeUndefined();
  });

  it.each([
    ["critical", true],
    ["high", true],
    ["moderate", false],
    ["low", false],
    ["unknown", false]
  ] as const)("%s is severe: %s", (severity, severe) => {
    expect(isSevere(severity)).toBe(severe);
  });
});

describe("shieldOf", () => {
  it("one advisory names its severity", () => {
    expect(shieldOf([LOW])).toEqual({ label: "1 known vulnerability (low)", severe: false });
  });

  it("several say how many and the worst", () => {
    expect(shieldOf([LOW, HIGH])).toEqual({ label: "2 known vulnerabilities, the worst is high", severe: true });
  });

  it("no advisory, no shield", () => {
    expect(shieldOf([])).toBeUndefined();
  });
});

describe("advisoryName", () => {
  it("is the last part of the address", () => {
    expect(advisoryName(HIGH)).toBe("GHSA-high");
    expect(advisoryName({ severity: "low", url: "https://example.org/a/b/?x=1" })).toBe("x=1");
    expect(advisoryName({ severity: "low", url: "" })).toBe("");
  });
});
