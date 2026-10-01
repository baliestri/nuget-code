import type { PackageFeed } from "#contracts";
import type {
  RegistrationIndex,
  RegistrationLeaf,
  RegistrationPage,
} from "#client/package-types";
import type { NuGetClientLogger, NuGetClientSettings } from "#client/types";
import { getFeedJson, getServiceResource } from "#client/feed-http";
import { networkFor } from "#client/client-network";
import { cachePolicy } from "#client/cache";
import { compareNuGetVersions, parseNuGetVersion } from "#manager";

/** Version names only: this resource never establishes listing status for automatic updates. */
export async function listPackageVersions(
  packageId: string,
  feed: PackageFeed,
  options: {
    settings: NuGetClientSettings;
    logger: NuGetClientLogger;
    signal?: AbortSignal | undefined;
    generation?: number | undefined;
  },
): Promise<string[] | undefined> {
  const network = networkFor(options.settings);
  const generation = options.generation ?? network.facts.generation;
  const resource = await getServiceResource(
    feed,
    "packagebaseaddress",
    options.settings,
    options.logger,
    options.signal,
    { generation },
  );
  if (!resource?.["@id"]) return undefined;
  try {
    return await network.facts.read(
      network.key([
        "version-list",
        feed.url,
        packageId.toLowerCase(),
        network.context(options.settings),
      ]),
      cachePolicy.metadataTtlMs,
      generation,
      async (signal) => {
        const url = new URL(
          `${encodeURIComponent(packageId.toLowerCase())}/index.json`,
          resource["@id"]!.replace(/\/?$/, "/"),
        ).toString();
        const result = await getFeedJson<{ versions: string[] }>({
          ...options,
          feed,
          url,
          generation,
          signal,
        });
        if (
          !Array.isArray(result.versions) ||
          result.versions.some(
            (version) =>
              typeof version !== "string" || !parseNuGetVersion(version),
          )
        )
          throw new Error("Invalid version list.");
        return result.versions;
      },
      options.signal,
    );
  } catch (error) {
    if (
      options.signal?.aborted ||
      (error instanceof Error && error.name === "AbortError")
    )
      throw error;
    return undefined;
  }
}

export async function readRegistrationEntries(
  registration: RegistrationIndex,
  feed: PackageFeed,
  options: {
    generation?: number | undefined;
    settings: NuGetClientSettings;
    logger: NuGetClientLogger;
    signal?: AbortSignal | undefined;
    packageId?: string;
  },
): Promise<{ entries: RegistrationLeaf[]; complete: boolean }> {
  options.signal?.throwIfAborted();
  if (!registration || !Array.isArray(registration.items))
    return { entries: [], complete: false };
  let complete =
    registration.count === undefined ||
    registration.count === registration.items.length;
  const entries: RegistrationLeaf[] = [];
  for (const page of registration.items) {
    options.signal?.throwIfAborted();
    try {
      const loaded: RegistrationPage = page?.items
        ? page
        : typeof page?.["@id"] === "string"
          ? await getFeedJson({ url: page["@id"], feed, ...options })
          : {};
      if (!Array.isArray(loaded.items)) {
        complete = false;
        continue;
      }
      if (
        (page.count !== undefined && page.count !== loaded.items.length) ||
        (loaded.count !== undefined && loaded.count !== loaded.items.length)
      )
        complete = false;
      for (const entry of loaded.items) {
        const item = entry?.catalogEntry;
        if (
          !item ||
          typeof item.version !== "string" ||
          !parseNuGetVersion(item.version) ||
          (item.listed !== undefined && typeof item.listed !== "boolean") ||
          (options.packageId !== undefined &&
            (typeof item.id !== "string" ||
              item.id.toLowerCase() !== options.packageId.toLowerCase()))
        ) {
          complete = false;
          continue;
        }
        entries.push(entry);
      }
    } catch (error) {
      if (
        options.signal?.aborted ||
        (error instanceof Error && error.name === "AbortError")
      )
        throw error;
      complete = false;
      options.logger.warning(
        "nuget.http",
        `Could not load a registration page from ${feed.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return {
    entries: entries.sort((a, b) =>
      compareNuGetVersions(a.catalogEntry.version, b.catalogEntry.version),
    ),
    complete,
  };
}
