import { describe, expect, it } from "vitest";
import type { NuGetPackageItem } from "#contracts";
import { packageChangeAction, projectVersionAction } from "./package-actions";
import {
  comparePackageVersions,
  isPrereleaseVersion,
  mergeVersions,
  packageVersions,
  samePackageVersion,
  upgradablePackageVersion,
} from "./versions";

describe("version helpers use NuGet precedence", () => {
  it("recognizes equivalence without offering a downgrade", () => {
    expect(samePackageVersion("1.0", "1.0.0+build")).toBe(true);
    expect(projectVersionAction("1.0", "1.0.0+build")).toBe("remove");
    expect(comparePackageVersions("1.0.0", "1.0.0-beta")).toBeGreaterThan(0);
  });

  it("does not mistake metadata for a prerelease label", () => {
    expect(isPrereleaseVersion("1.0.0+build-preview")).toBe(false);
    expect(isPrereleaseVersion("1.0.0--")).toBe(true);
    expect(isPrereleaseVersion("1.0.0-rc.1")).toBe(true);
    expect(isPrereleaseVersion(undefined)).toBe(false);
    expect(isPrereleaseVersion("not-a-version")).toBe(false);
  });

  it("keeps unresolved versions out of sorting and automatic action classification", () => {
    const item: NuGetPackageItem = {
      id: "demo",
      name: "Demo",
      installedVersion: "[1,2)",
      availableVersion: "1.5.0",
      projectPaths: ["a.csproj"],
      versions: [{ version: "invalid", source: "feed" }],
      dependencyGroups: [],
    };
    expect(packageVersions(item)).toEqual(["1.5.0"]);
    expect(
      mergeVersions(item.versions, [{ version: "1.5.0", source: "feed" }]),
    ).toEqual([{ version: "1.5.0", source: "feed" }]);
    expect(projectVersionAction("[1,2)", "1.5.0")).toBe("remove");
    expect(projectVersionAction(undefined, "invalid")).toBe("remove");
    expect(
      packageChangeAction("upgradeSelectedPackage", item, "1.5.0", [
        "a.csproj",
      ]),
    ).toBe("Changing");
  });

  it("does not label an equivalent explicit selection as a downgrade", () => {
    const item: NuGetPackageItem = {
      id: "demo",
      name: "Demo",
      installedVersion: "1.0",
      projectPaths: ["a.csproj"],
      versions: [],
      dependencyGroups: [],
    };
    expect(
      packageChangeAction("upgradeSelectedPackage", item, "1.0.0+build", [
        "a.csproj",
      ]),
    ).toBe("Changing");
  });

  it.each([
    ["2.0.0", "1.0.0", undefined],
    ["1.0.0", "1.0.0-beta", undefined],
    ["1.0.0+abc", "1.0+xyz", undefined],
    ["[1,2)", "2.0.0", undefined],
    ["1.0.0", "invalid", undefined],
    ["1.0.0-beta", "1.0.0", "1.0.0"],
    ["1.0.0", "1.0.1", "1.0.1"],
  ])(
    "offers only real upgrades from %s to %s",
    (installed, available, result) => {
      const item: NuGetPackageItem = {
        id: "demo",
        name: "Demo",
        installedVersion: installed,
        availableVersion: available,
        projectPaths: [],
        versions: [],
        dependencyGroups: [],
      };
      expect(upgradablePackageVersion(item)).toBe(result);
    },
  );
});
