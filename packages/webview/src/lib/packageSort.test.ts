import { describe, expect, it } from "vitest";
import type { NuGetPackageItem } from "#contracts";
import { sortPackages } from "./packageSort.js";

describe("package sort helpers", () => {
  it("groups upgradable packages first in smart mode", () => {
    const packages = [
      packageItem("z", "Zulu", "1.0.0"),
      packageItem("a", "Alpha", "1.0.0", "2.0.0"),
      packageItem("m", "Mike", "1.0.0", "1.0.0"),
      packageItem("b", "Beta", "1.0.0", "1.5.0"),
    ];

    expect(sortPackages(packages, "smart").map((item) => item.name)).toEqual([
      "Alpha",
      "Beta",
      "Zulu",
      "Mike",
    ]);
  });

  it("sorts packages alphabetically by name without considering upgrades", () => {
    const packages = [
      packageItem("z", "Zulu", "1.0.0", "2.0.0"),
      packageItem("a", "alpha", "1.0.0"),
      packageItem("m", "Mike", "1.0.0"),
    ];

    expect(
      sortPackages(packages, "alphabetical").map((item) => item.name),
    ).toEqual(["alpha", "Mike", "Zulu"]);
    expect(packages.map((item) => item.name)).toEqual([
      "Zulu",
      "alpha",
      "Mike",
    ]);
  });
});

function packageItem(
  id: string,
  name: string,
  installedVersion?: string,
  availableVersion?: string,
): NuGetPackageItem {
  return {
    id,
    name,
    installedVersion,
    availableVersion,
    projectPaths: [],
    versions: [],
    dependencyGroups: [],
  };
}
