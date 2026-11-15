import {
  PackageChangeKinds,
  type AdvisoryInfo,
  type PackageChangeParams,
  type ProjectInfo
} from "@nuget-code/protocol";
import { useQueries } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { SideBar } from "../app/SideBar";
import { useBridge, useSession } from "../bridge/BridgeContext";
import { useDebounced } from "../lib/useDebounced";
import { useOperation } from "../state/operation";
import { usePreferences } from "../state/PreferencesContext";
import { Banner } from "../ui/Banner";
import { IconButton } from "../ui/IconButton";
import { Menu } from "../ui/Menu";
import { packageMenu, Shortcuts, type PackageMenuAction } from "./contextMenu";
import { DetailsPanel, NoSelection } from "./DetailsPanel";
import { DiscoverView } from "./DiscoverView";
import { InstalledView } from "./InstalledView";
import {
  buildRows,
  buildTransitiveRows,
  filterRows,
  sortRows,
  targetOptions,
  updateChanges,
  type PackageRow
} from "./model";
import { OperationBar, ResultBanner } from "./OperationStatus";
import {
  queryKeys,
  useDetails,
  useInstalled,
  useRefresh,
  useSearch,
  useSolutionSync,
  useSources,
  useTransitiveUpdates,
  useUpdates,
  useVulnerabilities
} from "./queries";
import { advisoriesFor, advisoryIndex, shieldOf } from "./vulnerabilities";
import { Toolbar } from "./Toolbar";

const SEARCH_DELAY_MS = 300;
/** Icons of installed packages are fetched for this many at most, so a huge solution does not flood the feeds. */
const ICON_LIMIT = 60;
const NO_PROJECTS: readonly ProjectInfo[] = [];

/** The versions of a referenced package that the last restore resolved in the target. */
const resolvedVersions = (row: PackageRow): string[] =>
  row.projects.flatMap((use) => (use.resolved === undefined ? [] : [use.resolved]));

/** The Packages tab: the installed and the available packages on the left, the selected one on the right. */
export function PackagesTab(): ReactNode {
  const bridge = useBridge();
  const session = useSession();
  const { preferences, set } = usePreferences();
  const operation = useOperation();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState({ info: false, dependencies: false });
  /** The package whose menu is open, and where. */
  const [menu, setMenu] = useState<{ id: string; at: { x: number; y: number } }>();
  const lists = useRef<HTMLElement>(null);
  const closeMenu = useCallback(() => setMenu(undefined), []);
  const query = useDebounced(search.trim(), SEARCH_DELAY_MS);

  const projects = session?.solution.kind === "open" ? session.solution.projects : NO_PROJECTS;
  // A remembered target that is not a project of this solution means the whole solution.
  const target = projects.some((project) => project.path === preferences.target) ? preferences.target : null;
  const { feed, prerelease } = preferences;

  useSolutionSync();
  const installed = useInstalled();
  const updates = useUpdates(prerelease);
  const sources = useSources();
  const discovering = preferences.packagesView === "discover";
  const found = useSearch(query, feed, prerelease, discovering);
  const hasTransitive = installed.data?.projects.some((project) => project.transitive.length > 0) === true;
  const transitiveUpdates = useTransitiveUpdates(prerelease, hasTransitive);
  // The setting of the editor: with the audit off nothing is asked and nothing is shown.
  const audit = session?.audit !== false;
  const vulnerabilities = useVulnerabilities(audit);
  const advisories = useMemo(
    () => advisoryIndex(audit ? vulnerabilities.data : undefined),
    [audit, vulnerabilities.data]
  );
  const refresh = useRefresh(prerelease, hasTransitive, audit);
  // The pages of a package, for its menu, come with its details; asked for when the menu opens.
  const menuDetails = useDetails(menu?.id, feed, prerelease);

  const allRows = useMemo(
    () =>
      installed.data === undefined
        ? []
        : buildRows({ installed: installed.data, projects, target, updates: updates.data, feed, prerelease }),
    [installed.data, projects, target, updates.data, feed, prerelease]
  );
  const rows = useMemo(
    () =>
      sortRows(
        filterRows(allRows, query),
        preferences.sort,
        (row) => advisoriesFor(advisories, row.id, resolvedVersions(row)).length > 0
      ),
    [allRows, query, preferences.sort, advisories]
  );
  const updateCount = allRows.filter((row) => row.hasUpdate).length;
  const allTransitive = useMemo(
    () =>
      installed.data === undefined
        ? []
        : buildTransitiveRows({
            installed: installed.data,
            projects,
            target,
            updates: transitiveUpdates.data,
            feed,
            prerelease
          }),
    [installed.data, projects, target, transitiveUpdates.data, feed, prerelease]
  );
  const transitiveRows = useMemo(
    () =>
      sortRows(
        filterRows(allTransitive, query),
        preferences.sort,
        (row) => advisoriesFor(advisories, row.id, row.versions).length > 0
      ),
    [allTransitive, query, preferences.sort, advisories]
  );
  /** The known vulnerabilities of a package in what the target has of it, referenced or transitive. */
  const advisoriesOf = (id: string): AdvisoryInfo[] => {
    const lower = id.toLowerCase();
    return advisoriesFor(advisories, id, [
      ...allRows.filter((row) => row.id.toLowerCase() === lower).flatMap(resolvedVersions),
      ...allTransitive.filter((row) => row.id.toLowerCase() === lower).flatMap((row) => row.versions)
    ]);
  };
  const vulnerableCount = new Set(
    [...allRows, ...allTransitive].filter((row) => advisoriesOf(row.id).length > 0).map((row) => row.id.toLowerCase())
  ).size;

  // The icons of the installed packages come with their details, which are asked for once and kept.
  const iconIds = allRows.slice(0, ICON_LIMIT).map((row) => row.id);
  const icons = useQueries({
    queries: iconIds.map((id) => ({
      queryKey: queryKeys.details(id, feed, prerelease),
      queryFn: () =>
        bridge.backend("packageDetails", { id, ...(feed === null ? {} : { feed }), prerelease, noCache: false })
    }))
  });
  const iconOf = (id: string): string | undefined => {
    const index = iconIds.indexOf(id);
    return index < 0 ? undefined : icons[index]?.data?.iconUrl;
  };

  const targetProjects = target === null ? projects : projects.filter((project) => project.path === target);
  const targetName = target === null ? "Solution" : (targetProjects[0]?.name ?? "Solution");
  const selectedRow = allRows.find((row) => row.id.toLowerCase() === selectedId?.toLowerCase());
  const selectedTransitive = allTransitive.find((row) => row.id.toLowerCase() === selectedId?.toLowerCase());

  const change = (
    title: string,
    changes: PackageChangeParams[],
    action: () => ReturnType<typeof bridge.backend<"updatePackages">>
  ): void => {
    void operation.run(title, action, () => bridge.backend("planPackages", { changes }));
  };
  const update = (id: string, paths: readonly string[], version: string): void => {
    const changes = [{ kind: PackageChangeKinds.update, id, version, projects: paths }];
    change("Update", changes, () => bridge.backend("updatePackages", { changes }));
  };
  const updateChecked = (): void => {
    const changes = updateChanges(allRows, checked);
    if (changes.length > 0) {
      change("Update", changes, () => bridge.backend("updatePackages", { changes }));
      setChecked(new Set());
    }
  };
  const install = (id: string, paths: readonly string[], version: string): void => {
    change("Install", [{ kind: PackageChangeKinds.install, id, version, projects: paths }], () =>
      bridge.backend("installPackage", { id, version, projects: paths })
    );
  };
  const remove = (id: string, paths: readonly string[]): void => {
    change("Remove", [{ kind: PackageChangeKinds.remove, id, projects: paths }], () =>
      bridge.backend("removePackage", { id, projects: paths })
    );
  };

  const menuEntries =
    menu === undefined
      ? []
      : packageMenu({
          id: menu.id,
          row: allRows.find((row) => row.id.toLowerCase() === menu.id.toLowerCase()),
          transitive: allTransitive.find((row) => row.id.toLowerCase() === menu.id.toLowerCase()),
          advisories: advisoriesOf(menu.id),
          targetName,
          details: menuDetails.data,
          feeds: sources.data?.effective ?? [],
          globalPackagesFolder: sources.data?.globalPackagesFolder,
          busy: operation.running
        });

  const openMenu = (id: string, at: { x: number; y: number }): void => {
    setSelectedId(id);
    setMenu({ id, at });
  };
  const act = (action: PackageMenuAction): void => {
    switch (action.kind) {
      case "update": {
        const changes = updateChanges(allRows, new Set([action.id]));
        if (changes.length > 0) {
          change("Update", changes, () => bridge.backend("updatePackages", { changes }));
        }

        break;
      }
      case "remove":
        remove(action.id, action.projects);
        break;
      case "openFolder":
        // The one item that can fail for a reason worth telling: the package was never downloaded.
        void bridge
          .host("openFolder", { path: action.path })
          .catch((error: unknown) =>
            bridge
              .host("notify", { kind: "warning", messages: [error instanceof Error ? error.message : String(error)] })
              .catch(() => {})
          );
        break;
      case "openExternal":
        void bridge.host("openExternal", { url: action.url }).catch(() => {});
        break;
      case "toggleInfo":
        setExpanded((current) => ({ ...current, info: !current.info }));
        break;
      case "toggleDependencies":
        setExpanded((current) => ({ ...current, dependencies: !current.dependencies }));
        break;
      case "copy":
        void bridge.host("copyText", { text: action.text }).catch(() => {});
        break;
    }
  };

  /** The keys of the selected package: the menu itself, and what three of its items do. */
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (selectedId === undefined || menu !== undefined || !(event.ctrlKey || event.metaKey) || event.altKey) {
      return;
    }

    const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement;
    const key = event.key.toLowerCase();
    if (key === ".") {
      // Under the line of the package, when it is in sight; else at the corner of the lists.
      const line = [...(lists.current?.querySelectorAll<HTMLElement>("[data-package]") ?? [])].find(
        (item) => item.dataset["package"]?.toLowerCase() === selectedId.toLowerCase()
      );
      const box = (line ?? lists.current)?.getBoundingClientRect();
      event.preventDefault();
      setMenu({
        id: selectedId,
        at: { x: (box?.left ?? 0) + 24, y: line === undefined ? (box?.top ?? 0) : box!.bottom }
      });
    } else if (key === "i" && !typing) {
      event.preventDefault();
      act({ kind: "toggleInfo" });
    } else if (key === "d" && !typing) {
      event.preventDefault();
      act({ kind: "toggleDependencies" });
    } else if (key === "c" && !typing && (window.getSelection()?.toString() ?? "") === "") {
      // With text selected, the keys copy that text, as everywhere else.
      event.preventDefault();
      act({ kind: "copy", text: selectedId });
    }
  };

  const side = preferences.detailsPosition === "side";
  // A feed that fails more than one of the questions is said once.
  const failures = [
    ...new Map(
      [
        ...(updates.data?.failures ?? []),
        ...(audit ? (vulnerabilities.data?.failures ?? []) : []),
        ...(discovering ? (found.data?.failures ?? []) : [])
      ].map((failure) => [`${failure.feed}/${failure.kind}`, failure])
    ).values()
  ];

  return (
    <>
      <SideBar>
        <IconButton icon="refresh" label="Refresh NuGet Packages and Clear the Caches" onClick={refresh} />
        <IconButton
          icon={side ? "split-vertical" : "split-horizontal"}
          label={side ? "Show Details Below" : "Show Details on the Side"}
          onClick={() => set({ detailsPosition: side ? "bottom" : "side" })}
        />
        <IconButton
          icon="sort-precedence"
          label={
            preferences.sort === "smart"
              ? "Sort: Smart. Click for Alphabetically"
              : "Sort: Alphabetically. Click for Smart"
          }
          pressed={preferences.sort === "alphabetical"}
          onClick={() => set({ sort: preferences.sort === "smart" ? "alphabetical" : "smart" })}
        />
      </SideBar>
      {/* The keys are heard here, around both sides, wherever in them the focus is. */}
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        data-details={preferences.detailsPosition}
        onKeyDown={onKeyDown}
        className={`flex min-h-0 min-w-0 flex-1 ${side ? "flex-row" : "flex-col"}`}
      >
        <section ref={lists} aria-label="Packages" className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Toolbar
            search={search}
            onSearch={setSearch}
            targets={targetOptions(projects, installed.data)}
            target={target}
            onTarget={(value) => {
              set({ target: value });
              setChecked(new Set());
            }}
            feeds={sources.data?.effective ?? []}
            feed={feed}
            onFeed={(value) => set({ feed: value })}
            onManageFeeds={() => set({ tab: "sources" })}
            prerelease={prerelease}
            onPrerelease={(value) => set({ prerelease: value })}
          />
          <div role="tablist" aria-label="Package lists" className="flex gap-1 px-2 pb-1">
            <ListTab selected={!discovering} onSelect={() => set({ packagesView: "installed" })}>
              Installed
              {updateCount === 0 ? null : (
                <span
                  aria-label={`${updateCount} with updates`}
                  className="bg-badge text-badge-fg ml-1 rounded-full px-1.5"
                >
                  {updateCount}
                </span>
              )}
              {vulnerableCount === 0 ? null : (
                <span
                  aria-label={`${vulnerableCount} with known vulnerabilities`}
                  title={`${vulnerableCount} with known vulnerabilities`}
                  className="text-error ml-1 flex items-center gap-0.5"
                >
                  <i className="codicon codicon-shield" aria-hidden="true" />
                  {vulnerableCount}
                </span>
              )}
            </ListTab>
            <ListTab selected={discovering} onSelect={() => set({ packagesView: "discover" })}>
              Discover
            </ListTab>
            {selectedId === undefined ? null : (
              <span className="text-muted ml-auto self-center truncate opacity-70">
                {Shortcuts.menu} to show the context menu
              </span>
            )}
          </div>
          {failures.map((failure) => (
            <Banner key={`${failure.feed}/${failure.kind}`} kind="warning">
              {failure.feed}: {failure.message}
            </Banner>
          ))}
          {installed.isError && !discovering ? (
            <Banner kind="error">The installed packages could not be read. {installed.error.message}</Banner>
          ) : null}
          {discovering ? (
            <DiscoverView
              packages={found.data?.packages}
              loading={found.isFetching}
              error={found.isError ? found.error.message : undefined}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onMenu={openMenu}
            />
          ) : (
            <InstalledView
              rows={rows}
              targetName={targetName}
              loading={installed.isPending && !installed.isError}
              updatesLoading={updates.isFetching}
              transitive={transitiveRows}
              transitiveLoading={transitiveUpdates.isFetching}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onMenu={openMenu}
              checked={checked}
              onCheck={setChecked}
              onUpdate={updateChecked}
              busy={operation.running}
              iconOf={iconOf}
              shieldOf={(id, versions) => shieldOf(advisoriesFor(advisories, id, versions))}
            />
          )}
          <OperationBar />
        </section>
        <section
          aria-label="Details"
          className={`border-border flex min-h-0 min-w-0 flex-1 flex-col ${side ? "border-l" : "border-t"}`}
        >
          <ResultBanner />
          {selectedId === undefined ? (
            <NoSelection />
          ) : (
            <DetailsPanel
              key={selectedId.toLowerCase()}
              id={selectedId}
              row={selectedRow}
              transitive={selectedTransitive}
              advisories={advisoriesOf(selectedId)}
              projects={targetProjects}
              feed={feed}
              prerelease={prerelease}
              busy={operation.running}
              expanded={expanded}
              onExpanded={setExpanded}
              onInstall={(paths, version) => install(selectedId, paths, version)}
              onUpdate={(paths, version) => update(selectedId, paths, version)}
              onRemove={(paths) => remove(selectedId, paths)}
            />
          )}
        </section>
      </div>
      {menu === undefined ? null : (
        <Menu label={`Actions for ${menu.id}`} entries={menuEntries} at={menu.at} onAction={act} onClose={closeMenu} />
      )}
    </>
  );
}

function ListTab({
  selected,
  onSelect,
  children
}: {
  selected: boolean;
  onSelect(): void;
  children: ReactNode;
}): ReactNode {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className={`flex items-center rounded px-2 py-0.5 ${selected ? "border-border bg-surface border" : "hover:bg-hover border border-transparent"}`}
    >
      {children}
    </button>
  );
}
