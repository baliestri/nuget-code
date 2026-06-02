import type { NuGetPackageItem, PackageVersionInfo } from "#contracts";

export function isPrereleaseVersion(version: string | undefined): boolean {
  return Boolean(version && /-\w/.test(version));
}

export function samePackageVersion(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: "base" }) === 0;
}

export function comparePackageVersions(a: string, b: string): number {
  return a.localeCompare(b, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function packageVersions(packageItem: NuGetPackageItem): string[] {
  return Array.from(
    new Set(
      [
        ...packageItem.versions.map((version) => version.version),
        packageItem.installedVersion,
        packageItem.availableVersion,
      ].filter((version): version is string => Boolean(version)),
    ),
  ).sort(comparePackageVersions);
}

export function latestPackageVersion(
  packageItem: NuGetPackageItem | undefined,
): string | undefined {
  if (!packageItem) {
    return undefined;
  }
  const versions = packageVersions(packageItem);
  return versions[versions.length - 1];
}

export function defaultPackageVersion(packageItem: NuGetPackageItem): string {
  return (
    packageItem.installedVersion || latestPackageVersion(packageItem) || ""
  );
}

export function upgradablePackageVersion(
  packageItem: NuGetPackageItem,
): string | undefined {
  if (
    !packageItem.installedVersion ||
    !packageItem.availableVersion ||
    samePackageVersion(
      packageItem.installedVersion,
      packageItem.availableVersion,
    )
  ) {
    return undefined;
  }
  return packageItem.availableVersion;
}

export function mergeVersions(
  current: PackageVersionInfo[],
  next: PackageVersionInfo[],
): PackageVersionInfo[] {
  const keys = new Set(current.map((version) => version.version));

  return [
    ...current,
    ...next.filter((version) => !keys.has(version.version)),
  ].sort((a, b) => comparePackageVersions(a.version, b.version));
}

export function prependVersion(
  versions: PackageVersionInfo[],
  version: PackageVersionInfo,
): PackageVersionInfo[] {
  if (versions.some((item) => item.version === version.version)) {
    return versions;
  }

  return [version, ...versions];
}
