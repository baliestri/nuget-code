import type { PackageFeed } from "#contracts";
import type {
  RegistrationIndex,
  RegistrationLeaf,
  RegistrationPage,
} from "#client/package-types";
import type { NuGetClientLogger, NuGetClientSettings } from "#client/types";
import { getFeedJson } from "#client/feed-http";
import { compareNuGetVersions, parseNuGetVersion } from "#manager";

export async function readRegistrationEntries(
  registration: RegistrationIndex,
  feed: PackageFeed,
  options: {
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
