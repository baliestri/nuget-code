import type { FeedInfo, PackageDetailsResult } from "@nuget-code/protocol";
import type { MenuEntry } from "../ui/Menu";
import type { PackageRow } from "./model";

/** What an item of the package menu does. */
export type PackageMenuAction =
  | { kind: "update"; id: string }
  | { kind: "remove"; id: string; projects: readonly string[] }
  | { kind: "openFolder"; path: string }
  | { kind: "openExternal"; url: string }
  | { kind: "toggleInfo" }
  | { kind: "toggleDependencies" }
  | { kind: "copy"; text: string };

export interface PackageMenuInput {
  id: string;
  /** The package as installed in the target; absent when no project of the target has it. */
  row: PackageRow | undefined;
  /** The name of the target, as the lists say it: "Solution" or a project. */
  targetName: string;
  /** What is known about the package; absent while it is being fetched. */
  details: PackageDetailsResult | undefined;
  feeds: readonly FeedInfo[];
  /** Where restored packages are kept; absent while it is not known. */
  globalPackagesFolder: string | undefined;
  /** An operation is running: nothing that changes packages can be started. */
  busy: boolean;
}

/** The keys that open the menu and do what some of its items do, as the menu and the hint show them. */
export const Shortcuts = {
  menu: "Ctrl+.",
  info: "Ctrl+I",
  dependencies: "Ctrl+D",
  copy: "Ctrl+C"
} as const;

/** Whether the feed of that name is nuget.org, going by the server of its address. */
export function isNuGetOrg(feedName: string | undefined, feeds: readonly FeedInfo[]): boolean {
  const feed = feeds.find((item) => item.name === feedName);
  if (feed === undefined) {
    return false;
  }

  try {
    const host = new URL(feed.source).hostname.toLowerCase();
    return host === "nuget.org" || host.endsWith(".nuget.org");
  } catch {
    // A folder, not an address.
    return false;
  }
}

/** The folder of a package inside the global packages folder, where its name and version are in lower case. */
export function packageFolder(globalPackagesFolder: string, id: string, version?: string): string {
  const separator = globalPackagesFolder.includes("\\") ? "\\" : "/";
  const root = globalPackagesFolder.replace(/[\\/]+$/, "");
  return [root, id.toLowerCase(), ...(version === undefined ? [] : [version.toLowerCase()])].join(separator);
}

/**
 * The items of the menu of a package, after the menu of the NuGet window of Rider. What cannot be done for
 * this package is left out, not shown disabled; only what has to wait, for an operation that is running or
 * for the details to arrive, is disabled.
 */
export function packageMenu(input: PackageMenuInput): MenuEntry<PackageMenuAction>[] {
  const { id, row, details } = input;
  const groups: MenuEntry<PackageMenuAction>[][] = [];

  const changes: MenuEntry<PackageMenuAction>[] = [];
  if (row !== undefined && row.hasUpdate && row.latest !== undefined) {
    changes.push({
      kind: "item",
      label: `Update ${id} in ${input.targetName} from ${row.versions.join(", ")} to ${row.latest}`,
      icon: "arrow-circle-up",
      disabled: input.busy,
      action: { kind: "update", id }
    });
  }

  const removable = row?.projects.filter((use) => !use.implicit) ?? [];
  if (removable.length > 0) {
    changes.push({
      kind: "item",
      label: `Remove ${id} from ${removable.length === 1 ? removable[0]!.name : `${removable.length} projects`}`,
      icon: "trash",
      disabled: input.busy,
      action: { kind: "remove", id, projects: removable.map((use) => use.path) }
    });
  }

  groups.push(changes);

  const folders: MenuEntry<PackageMenuAction>[] = [];
  if (input.globalPackagesFolder !== undefined) {
    const root = input.globalPackagesFolder;
    const restored = new Set(
      (row?.projects ?? []).flatMap((use) => (use.restored && use.resolved !== undefined ? [use.resolved] : []))
    );
    for (const version of restored) {
      folders.push({
        kind: "item",
        label: `Show ${version} in File Explorer`,
        action: { kind: "openFolder", path: packageFolder(root, id, version) }
      });
    }

    folders.push({
      kind: "item",
      label: "Show All Package Versions in File Explorer",
      action: { kind: "openFolder", path: packageFolder(root, id) }
    });
  }

  groups.push(folders);

  // The pages of the package come with its details. Until they arrive the items wait, disabled.
  const loading = details === undefined;
  const pages: MenuEntry<PackageMenuAction>[] = [];
  if (loading || isNuGetOrg(details.feed, input.feeds)) {
    pages.push({
      kind: "item",
      label: "Show Package on NuGet.Org",
      icon: "globe",
      disabled: loading,
      action: { kind: "openExternal", url: `https://www.nuget.org/packages/${encodeURIComponent(id)}` }
    });
  }

  if (loading || details.projectUrl !== undefined) {
    pages.push({
      kind: "item",
      label: "Show Project Page",
      disabled: loading,
      action: { kind: "openExternal", url: details?.projectUrl ?? "" }
    });
  }

  if (loading || details.licenseUrl !== undefined) {
    pages.push({
      kind: "item",
      label: details?.license === undefined ? "Show License Page" : `Show License Page (${details.license})`,
      disabled: loading,
      action: { kind: "openExternal", url: details?.licenseUrl ?? "" }
    });
  }

  pages.push({
    kind: "item",
    label: "Search Package with Google",
    action: {
      kind: "openExternal",
      url: `https://www.google.com/search?q=${encodeURIComponent(`${id} NuGet`)}`
    }
  });
  groups.push(pages);

  groups.push([
    { kind: "item", label: "Toggle NuGet Info Expander", shortcut: Shortcuts.info, action: { kind: "toggleInfo" } },
    {
      kind: "item",
      label: "Toggle NuGet Dependencies Expander",
      shortcut: Shortcuts.dependencies,
      action: { kind: "toggleDependencies" }
    },
    {
      kind: "item",
      label: "Copy Package Name to Clipboard",
      icon: "copy",
      shortcut: Shortcuts.copy,
      action: { kind: "copy", text: id }
    }
  ]);

  return groups
    .filter((group) => group.length > 0)
    .flatMap((group, index) => (index === 0 ? group : [{ kind: "separator" } as const, ...group]));
}
