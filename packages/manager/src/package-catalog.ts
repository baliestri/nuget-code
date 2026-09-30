import type { CatalogVersion, PackageCatalog } from "#contracts";
import {
  compareNuGetVersions,
  parseNuGetVersion,
} from "#manager/nuget-version";

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareText);
}

export function normalizeCatalogFeedUrl(value: string): string | undefined {
  if (!value) return undefined;
  if (!/^https?:\/\//i.test(value)) return value;
  try {
    return new URL(value).toString();
  } catch {
    return undefined;
  }
}

function mergePackageCatalogs(
  packageId: string,
  catalogs: readonly PackageCatalog[],
): PackageCatalog {
  let complete = catalogs.every((catalog) => catalog.complete);
  const entries: CatalogVersion[] = [];
  for (const catalog of catalogs) {
    for (const item of catalog.versions) {
      const parsed = parseNuGetVersion(item.version);
      if (!parsed) {
        complete = false;
        continue;
      }
      const urls = item.feedUrls.map(normalizeCatalogFeedUrl);
      if (urls.length === 0 || urls.some((url) => url === undefined)) {
        complete = false;
      }
      const feedUrls = uniqueSorted(
        urls.filter((url): url is string => url !== undefined),
      );
      if (feedUrls.length === 0) continue;
      entries.push({
        version: parsed.normalized.toLowerCase(),
        feedUrls,
        listed: item.listed,
      });
    }
  }

  entries.sort(
    (a, b) =>
      compareNuGetVersions(a.version, b.version) ||
      Number(b.listed) - Number(a.listed) ||
      compareText(a.version, b.version),
  );
  const versions: CatalogVersion[] = [];
  for (const entry of entries) {
    const previous = versions.at(-1);
    if (
      previous &&
      previous.listed === entry.listed &&
      compareNuGetVersions(previous.version, entry.version) === 0
    ) {
      previous.feedUrls = uniqueSorted([
        ...previous.feedUrls,
        ...entry.feedUrls,
      ]);
    } else {
      versions.push(entry);
    }
  }

  // Opaque, collision-free identity of the contributing revisions and projection.
  // Keep it independent of arrival order and of the host's locale or hash APIs.
  const revision = JSON.stringify([
    packageId,
    uniqueSorted(catalogs.map((catalog) => catalog.revision)),
    complete,
    versions,
  ]);
  const iconUrl = catalogs
    .map((catalog) => catalog.iconUrl)
    .filter((url): url is string => !!url)
    .sort()[0];
  return {
    packageId,
    versions,
    complete,
    revision,
    ...(iconUrl ? { iconUrl } : {}),
  };
}

/** Compose source catalogs without allowing feed arrival order to select updates. */
export function mergeCatalogs(
  items: readonly PackageCatalog[],
): PackageCatalog[] {
  const groups = new Map<string, PackageCatalog[]>();
  for (const item of items) {
    const key = item.packageId.toLowerCase();
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => compareText(a, b))
    .map(([packageId, catalogs]) => mergePackageCatalogs(packageId, catalogs));
}
