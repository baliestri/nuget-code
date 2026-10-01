import { createHash } from "node:crypto";
import type { PackageCatalog, PackageFeed } from "#contracts";
import type { NuGetClientLogger, NuGetClientSettings } from "#client/types";
import { getFeedJson, getServiceResource } from "#client/feed-http";
import { HttpError } from "#client/utils";
import {
  readRegistrationEntries,
  listPackageVersions,
} from "#client/package-registration";
import { readLocalPackageVersions } from "#client/local-package-catalog";
import type { RegistrationIndex } from "#client/package-types";
import { isHttpUrl, mergeCatalogs, packageMetadataUrl } from "#manager";
import { networkFor } from "#client/client-network";
import { cachePolicy } from "#client/cache";

export interface PackageCatalogOptions {
  force?: boolean;
  generation?: number | undefined;
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
  const network = networkFor(options.settings);
  return network.facts.read(
    network.key([
      "catalog",
      feed.url,
      options.packageId.toLowerCase(),
      network.context(options.settings),
    ]),
    cachePolicy.metadataTtlMs,
    options.generation ?? network.facts.generation,
    (signal) => loadFeedCatalogUncached({ ...options, signal }, feed),
    options.signal,
    (value) => value.complete,
  );
}
async function loadFeedCatalogUncached(
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
    const versionNames = await listPackageVersions(packageId, feed, options);
    const resource = await getServiceResource(
      feed,
      "registrationsbaseurl",
      settings,
      logger,
      signal,
      { generation: options.generation },
    );
    if (!resource?.["@id"])
      return catalog(
        packageId,
        feed.url,
        (versionNames ?? []).map((version) => ({
          version,
          feedUrls: [feed.url],
          listed: false,
        })),
        false,
      );
    const base = resource["@id"].endsWith("/")
      ? resource["@id"]
      : `${resource["@id"]}/`;
    const url = new URL(
      `${encodeURIComponent(packageId.toLowerCase())}/index.json`,
      base,
    ).toString();
    let registration: RegistrationIndex;
    try {
      registration = await getFeedJson({
        url,
        feed,
        settings,
        logger,
        signal,
        generation: options.generation,
      });
    } catch (error) {
      if (error instanceof HttpError && error.statusCode === 404)
        return catalog(packageId, feed.url, [], true);
      throw error;
    }
    const result = await readRegistrationEntries(registration, feed, {
      ...options,
      packageId,
    });
    const value = catalog(
      packageId,
      feed.url,
      result.entries.map((entry) => ({
        version: entry.catalogEntry.version,
        feedUrls: [feed.url],
        listed: entry.catalogEntry.listed !== false,
      })),
      result.complete,
    );
    value.iconUrl = result.entries
      .map((entry) => packageMetadataUrl(entry.catalogEntry.iconUrl))
      .find((url) => !!url);
    return value;
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
  const network = networkFor(options.settings);
  options = {
    ...options,
    generation:
      options.generation ??
      (options.force ? network.refresh() : network.facts.generation),
  };
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
