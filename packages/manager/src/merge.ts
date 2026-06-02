import type { NuGetPackageItem, PackageFeed } from "#contracts";
import { mergeVersions } from "#manager/versions";

export function mergeAvailableFeeds(
  current: NuGetPackageItem["availableFeeds"],
  next: NuGetPackageItem["availableFeeds"],
): NuGetPackageItem["availableFeeds"] {
  const feeds = [...(current ?? [])];
  const ids = new Set(feeds.map((feed) => feed.id));
  for (const feed of next ?? []) {
    if (ids.has(feed.id)) {
      continue;
    }
    ids.add(feed.id);
    feeds.push(feed);
  }
  return feeds.length > 0 ? feeds : undefined;
}

export function mergeProjectStates(
  current: NuGetPackageItem["projectStates"],
  next: NuGetPackageItem["projectStates"],
): NuGetPackageItem["projectStates"] {
  const states = [...(current ?? [])];
  const keys = new Set(
    states.map((state) => `${state.projectPath}:${state.implicit ?? false}`),
  );
  for (const state of next ?? []) {
    const key = `${state.projectPath}:${state.implicit ?? false}`;
    if (keys.has(key)) {
      continue;
    }
    keys.add(key);
    states.push(state);
  }
  return states.length > 0 ? states : undefined;
}

export function mergeInstalled(
  packages: NuGetPackageItem[],
): NuGetPackageItem[] {
  const byName = new Map<string, NuGetPackageItem>();
  for (const item of packages) {
    const key = item.name.toLowerCase();
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, item);
      continue;
    }
    existing.projectPaths.push(...item.projectPaths);
    existing.projectStates = mergeProjectStates(
      existing.projectStates,
      item.projectStates,
    );
    existing.versions = mergeVersions(existing.versions, item.versions);
    existing.installedVersion =
      existing.installedVersion ?? item.installedVersion;
  }

  return Array.from(byName.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

export function mergePackageResults(
  packages: NuGetPackageItem[],
): NuGetPackageItem[] {
  const byName = new Map<string, NuGetPackageItem>();
  for (const item of packages) {
    const key = item.name.toLowerCase();
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, item);
      continue;
    }
    existing.versions = mergeVersions(existing.versions, item.versions);
    existing.sourceName = `${existing.sourceName}, ${item.sourceName}`;
    existing.iconUrl = existing.iconUrl ?? item.iconUrl;
    existing.availableFeeds = mergeAvailableFeeds(
      existing.availableFeeds,
      item.availableFeeds,
    );
  }

  return Array.from(byName.values());
}

export function applyAvailablePackageMetadata(
  packages: NuGetPackageItem[],
  availablePackages: NuGetPackageItem[],
): NuGetPackageItem[] {
  const availableByName = new Map(
    availablePackages.map((item) => [item.name.toLowerCase(), item]),
  );

  return packages.map((item) => {
    const available = availableByName.get(item.name.toLowerCase());
    if (!available) {
      return item;
    }

    return {
      ...item,
      availableVersion: available.availableVersion ?? item.availableVersion,
      sourceName: item.sourceName ?? available.sourceName,
      sourceUrl: item.sourceUrl ?? available.sourceUrl,
      iconUrl: item.iconUrl ?? available.iconUrl,
      description: item.description ?? available.description,
      authors: item.authors ?? available.authors,
      tags: item.tags ?? available.tags,
      published: item.published ?? available.published,
      versions: item.versions.length > 0 ? item.versions : available.versions,
      dependencyGroups:
        item.dependencyGroups.length > 0
          ? item.dependencyGroups
          : available.dependencyGroups,
      availableFeeds: mergeAvailableFeeds(
        item.availableFeeds,
        available.availableFeeds,
      ),
    };
  });
}

export function mergePackageDetails(
  current: NuGetPackageItem,
  details: NuGetPackageItem,
): NuGetPackageItem {
  return {
    ...current,
    availableVersion: details.availableVersion ?? current.availableVersion,
    sourceName: current.sourceName ?? details.sourceName,
    sourceUrl: current.sourceUrl ?? details.sourceUrl,
    iconUrl: current.iconUrl ?? details.iconUrl,
    description: current.description ?? details.description,
    authors: current.authors ?? details.authors,
    tags: current.tags ?? details.tags,
    published: current.published ?? details.published,
    versions:
      current.versions.length > 0
        ? mergeVersions(current.versions, details.versions)
        : details.versions,
    dependencyGroups:
      current.dependencyGroups.length > 0
        ? current.dependencyGroups
        : details.dependencyGroups,
    availableFeeds: mergeAvailableFeeds(
      current.availableFeeds,
      details.availableFeeds,
    ),
    deprecated: current.deprecated ?? details.deprecated,
    alternatePackage: current.alternatePackage ?? details.alternatePackage,
  };
}

export function mergePackageDetailsFromFeed(
  current: NuGetPackageItem,
  details: NuGetPackageItem,
  feed: PackageFeed,
): NuGetPackageItem {
  return {
    ...current,
    availableVersion: details.availableVersion ?? current.availableVersion,
    sourceName: feed.name,
    sourceUrl: feed.url,
    iconUrl: details.iconUrl ?? current.iconUrl,
    description: details.description ?? current.description,
    authors: details.authors ?? current.authors,
    tags: details.tags ?? current.tags,
    published: details.published ?? current.published,
    versions: details.versions.length > 0 ? details.versions : current.versions,
    dependencyGroups:
      details.dependencyGroups.length > 0
        ? details.dependencyGroups
        : current.dependencyGroups,
    availableFeeds: mergeAvailableFeeds(
      current.availableFeeds,
      details.availableFeeds,
    ),
    deprecated: details.deprecated ?? current.deprecated,
    alternatePackage: details.alternatePackage ?? current.alternatePackage,
  };
}

export function replacePackage(
  packages: NuGetPackageItem[],
  packageItem: NuGetPackageItem,
): NuGetPackageItem[] {
  let replaced = false;
  const next = packages.map((item) => {
    if (item.id !== packageItem.id) {
      return item;
    }
    replaced = true;
    return packageItem;
  });
  return replaced ? next : packages;
}
