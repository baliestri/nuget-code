import { describe, expect, it } from "vitest";
import {
  compareVersions,
  compareVersionTexts,
  isNewer,
  isPrerelease,
  newestVersion,
  parseVersion
} from "./nugetVersion";

function compare(left: string, right: string): number {
  return Math.sign(compareVersions(parseVersion(left)!, parseVersion(right)!));
}

describe("parseVersion", () => {
  it.each([
    "1.0.0",
    "1.0",
    "1",
    "1.2.3.4",
    "1.0.0-alpha",
    "1.0.0-alpha.1",
    "1.0.0+build.5",
    "1.0.0-rc.1+sha",
    " 2.0.0 "
  ])("%j is a version", (text) => {
    expect(parseVersion(text)).toBeDefined();
  });

  it.each([
    "",
    "abc",
    "1.*",
    "1.0.*",
    "[1.0,2.0)",
    "(,1.0]",
    "1.0.0-",
    "1.2.3.4.5",
    "v1.0.0",
    "1.0.0-al pha",
    "$(Version)"
  ])("%j is not a version", (text) => {
    expect(parseVersion(text)).toBeUndefined();
  });

  it("reads the numbers and the pre-release identifiers", () => {
    expect(parseVersion("1.2.3.4-rc.10+sha")).toEqual({ numbers: [1, 2, 3, 4], prerelease: ["rc", "10"] });
  });
});

describe("compareVersions", () => {
  it("orders releases by their numbers", () => {
    const ordered = ["1.0.0", "1.0.1", "1.1.0", "2.0.0", "10.0.0"];

    for (let index = 1; index < ordered.length; index++) {
      expect(compare(ordered[index - 1]!, ordered[index]!)).toBe(-1);
      expect(compare(ordered[index]!, ordered[index - 1]!)).toBe(1);
    }
  });

  it.each([
    ["1.0", "1.0.0"],
    ["1", "1.0.0.0"],
    ["1.0.0+a", "1.0.0+b"],
    ["1.0.0-RC", "1.0.0-rc"],
    ["1.0.0-rc.1+x", "1.0.0-rc.1"]
  ])("%s is the same version as %s", (left, right) => {
    expect(compare(left, right)).toBe(0);
  });

  it("the fourth number counts", () => {
    expect(compare("1.0.0.1", "1.0.0")).toBe(1);
  });

  it("orders pre-releases as SemVer does, below their release", () => {
    const ordered = [
      "1.0.0-1",
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-rc.2",
      "1.0.0-rc.10",
      "1.0.0"
    ];

    for (let index = 1; index < ordered.length; index++) {
      expect(compare(ordered[index - 1]!, ordered[index]!), `${ordered[index - 1]} < ${ordered[index]}`).toBe(-1);
    }
  });

  it("a pre-release of a newer version is newer than an older release", () => {
    expect(compare("2.0.0-beta", "1.9.9")).toBe(1);
  });
});

describe("helpers", () => {
  it("isPrerelease", () => {
    expect(isPrerelease("1.0.0-beta")).toBe(true);
    expect(isPrerelease("1.0.0")).toBe(false);
    expect(isPrerelease("1.0.0+meta")).toBe(false);
    expect(isPrerelease("1.*")).toBe(false);
  });

  it("newestVersion ignores what is not a version", () => {
    expect(newestVersion(["1.0.0", "1.*", "2.0.0-beta", "1.5.0"])).toBe("2.0.0-beta");
    expect(newestVersion(["1.*", ""])).toBeUndefined();
    expect(newestVersion([])).toBeUndefined();
  });

  it("isNewer needs two versions", () => {
    expect(isNewer("2.0.0", "1.0.0")).toBe(true);
    expect(isNewer("1.0.0", "1.0.0")).toBe(false);
    expect(isNewer("1.0.0", "2.0.0")).toBe(false);
    expect(isNewer("2.0.0", "1.*")).toBe(false);
    expect(isNewer("latest", "1.0.0")).toBe(false);
  });

  it("compareVersionTexts puts what is not a version first, and orders the rest", () => {
    expect(["2.0.0", "1.*", "1.0.0", "[1.0,2.0)", "1.0.0-beta"].toSorted(compareVersionTexts)).toEqual([
      "1.*",
      "[1.0,2.0)",
      "1.0.0-beta",
      "1.0.0",
      "2.0.0"
    ]);
  });
});
