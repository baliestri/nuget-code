import { createHash } from "node:crypto";
import type { PackageCatalog, PackageFeed } from "#contracts";
import type { NuGetClientLogger, NuGetClientSettings } from "#client/types";
import { getFeedJson, getServiceResource } from "#client/feed-http";
import { HttpError } from "#client/utils";
import { readRegistrationEntries } from "#client/package-registration";
import { readLocalPackageVersions } from "#client/local-package-catalog";
import type { RegistrationIndex } from "#client/package-types";
import { isHttpUrl, mergeCatalogs } from "#manager";

export interface PackageCatalogOptions {
  packageId: string;
  feeds: readonly PackageFeed[];
  settings: NuGetClientSettings;
  logger: NuGetClientLogger;
  signal?: AbortSignal | undefined;
}

function catalog(
  packageId: string,
  feedUrl: string,
  versions: PackageCatalog["versions"],
  complete: boolean,
): PackageCatalog {
  const revision = createHash("sha256")
    .update(JSON.stringify([feedUrl, versions, complete]))
    .digest("hex");
  return { packageId, versions, complete, revision };
}

async function loadFeedCatalog(
  options: PackageCatalogOptions,
  feed: PackageFeed,
): Promise<PackageCatalog> {
  const { packageId, settings, logger, signal } = options;
  try {
    signal?.throwIfAborted();
    if (!isHttpUrl(feed.url)) {
      const local = await readLocalPackageVersions(packageId, feed, options);
      return catalog(packageId, feed.url, local.versions, local.complete);
    }
    const resource = await getServiceResource(
      feed,
      "registrationsbaseurl",
      settings,
      logger,
      signal,
    );
    if (!resource?.["@id"])
      throw new Error("Source has no registration resource.");
    const base = resource["@id"].endsWith("/")
      ? resource["@id"]
      : `${resource["@id"]}/`;
    const url = new URL(
      `${encodeURIComponent(packageId.toLowerCase())}/index.json`,
      base,
    ).toString();
    let registration: RegistrationIndex;
    try {
      registration = await getFeedJson({ url, feed, settings, logger, signal });
    } catch (error) {
      if (error instanceof HttpError && error.statusCode === 404)
        return catalog(packageId, feed.url, [], true);
      throw error;
    }
    const result = await readRegistrationEntries(registration, feed, {
      ...options,
      packageId,
    });
    return catalog(
      packageId,
      feed.url,
      result.entries.map((entry) => ({
        version: entry.catalogEntry.version,
        feedUrls: [feed.url],
        listed: entry.catalogEntry.listed !== false,
      })),
      result.complete,
    );
  } catch (error) {
    if (
      signal?.aborted ||
      (error instanceof Error && error.name === "AbortError")
    )
      throw error;
    logger.warning(
      "nuget.packages",
      `Could not load the version catalog for ${packageId} from ${feed.name}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return catalog(packageId, feed.url, [], false);
  }
}

/** Loads source facts, never a prefiltered list of upgrade suggestions. */
export async function loadPackageCatalog(
  options: PackageCatalogOptions,
): Promise<PackageCatalog> {
  options.signal?.throwIfAborted();
  // NuGet's legacy ID grammar uses .NET Unicode word categories, not ASCII \w.
  if (
    options.packageId.length > 100 ||
    !/^[\p{L}\p{Mn}\p{Nd}\p{Pc}]+(?:[.-][\p{L}\p{Mn}\p{Nd}\p{Pc}]+)*(?![\s\S])/u.test(
      options.packageId,
    )
  )
    throw new Error("Invalid NuGet package ID.");
  const sources: PackageCatalog[] = [];
  for (const feed of options.feeds.filter(
    (feed) => feed.enabled && feed.id !== "__all__",
  )) {
    sources.push(await loadFeedCatalog(options, feed));
  }
  return (
    mergeCatalogs(sources)[0] ??
    catalog(options.packageId.toLowerCase(), "", [], true)
  );
}
