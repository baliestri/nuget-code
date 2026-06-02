import type { NuGetPackageItem } from "#contracts";
import { upgradablePackageVersion } from "#manager";

export const packageSortModes = ["smart", "alphabetical"] as const;

export type PackageSortMode = (typeof packageSortModes)[number];

export function sortPackages(
  packages: NuGetPackageItem[],
  mode: PackageSortMode,
): NuGetPackageItem[] {
  if (mode === "smart") {
    return [
      ...packages.filter((packageItem) =>
        Boolean(upgradablePackageVersion(packageItem)),
      ),
      ...packages.filter(
        (packageItem) => !upgradablePackageVersion(packageItem),
      ),
    ];
  }

  return [...packages].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
  );
}
