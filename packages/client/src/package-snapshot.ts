import { NuGetCli } from "#client/cli";
import { loadPackageInventory } from "#client/package-inventory";
import { searchPackages } from "#client/package-search";
import type { PackageSnapshot } from "#client/package-types";
import type { NuGetClientLogger, NuGetClientSettings } from "#client/types";
import type { PackageFeed } from "#contracts/nuget";
import type { WorkspaceTarget } from "#contracts/workspace";

export async function loadPackageSnapshot(options: {
  target: WorkspaceTarget | undefined;
  feeds: PackageFeed[];
  selectedFeedId: string;
  search: string;
  includePrerelease: boolean;
  settings: NuGetClientSettings;
  cli: NuGetCli;
  logger: NuGetClientLogger;
  signal?: AbortSignal | undefined;
}): Promise<PackageSnapshot> {
  const [inventory, available] = await Promise.all([
    loadPackageInventory({
      target: options.target,
      cli: options.cli,
      logger: options.logger,
      signal: options.signal,
    }),
    searchPackages({
      feeds: options.feeds,
      selectedFeedId: options.selectedFeedId,
      query: options.search,
      includePrerelease: options.includePrerelease,
      settings: options.settings,
      logger: options.logger,
      signal: options.signal,
    }),
  ]);

  return {
    ...inventory,
    available,
  };
}
