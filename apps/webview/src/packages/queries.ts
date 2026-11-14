import type {
  PackageDetailsResult,
  PackagesInstalledResult,
  PackagesSearchResult,
  PackagesUpdatesResult,
  SourcesListResult
} from "@nuget-code/protocol";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { useBridge, useBridgeEvent, useSession } from "../bridge/BridgeContext";

/** How many results a search asks for: the list is "Top 100". */
export const SEARCH_SIZE = 100;

export const queryKeys = {
  installed: ["installed"] as const,
  updates: (prerelease: boolean) => ["updates", prerelease] as const,
  sources: ["sources"] as const,
  folders: ["folders"] as const,
  search: (query: string, feed: string | null, prerelease: boolean) => ["search", query, feed, prerelease] as const,
  details: (id: string, feed: string | null, prerelease: boolean) =>
    ["details", id.toLowerCase(), feed, prerelease] as const
};

export function useInstalled(): UseQueryResult<PackagesInstalledResult> {
  const bridge = useBridge();
  return useQuery({ queryKey: queryKeys.installed, queryFn: () => bridge.backend("installedPackages", {}) });
}

export function useUpdates(prerelease: boolean): UseQueryResult<PackagesUpdatesResult> {
  const bridge = useBridge();
  return useQuery({
    queryKey: queryKeys.updates(prerelease),
    queryFn: () => bridge.backend("packageUpdates", { prerelease, noCache: false })
  });
}

export function useSources(): UseQueryResult<SourcesListResult> {
  const bridge = useBridge();
  return useQuery({ queryKey: queryKeys.sources, queryFn: () => bridge.backend("listSources", {}) });
}

export function useSearch(
  query: string,
  feed: string | null,
  prerelease: boolean,
  enabled: boolean
): UseQueryResult<PackagesSearchResult> {
  const bridge = useBridge();
  return useQuery({
    queryKey: queryKeys.search(query, feed, prerelease),
    queryFn: () =>
      bridge.backend("searchPackages", {
        ...(query === "" ? {} : { query }),
        ...(feed === null ? {} : { feed }),
        prerelease,
        skip: 0,
        take: SEARCH_SIZE
      }),
    enabled
  });
}

export function useDetails(
  id: string | undefined,
  feed: string | null,
  prerelease: boolean
): UseQueryResult<PackageDetailsResult> {
  const bridge = useBridge();
  return useQuery({
    queryKey: queryKeys.details(id ?? "", feed, prerelease),
    queryFn: () =>
      bridge.backend("packageDetails", { id: id!, ...(feed === null ? {} : { feed }), prerelease, noCache: false }),
    enabled: id !== undefined
  });
}

/** Fetches the installed packages and the updates again when the backend says the solution changed. */
export function useSolutionSync(): void {
  const queries = useQueryClient();
  const session = useSession();
  const invalidate = useCallback(() => {
    void queries.invalidateQueries({ queryKey: queryKeys.installed });
    void queries.invalidateQueries({ queryKey: ["updates"] });
  }, [queries]);
  useBridgeEvent("solutionDidChange", invalidate);
  useBridgeEvent("restoreDidFinish", invalidate);

  // Another solution was opened: nothing fetched for the previous one applies.
  const path = session?.solution.kind === "open" ? session.solution.path : undefined;
  useEffect(() => {
    invalidate();
  }, [path, invalidate]);
}

/** Fetches everything about packages again, asking the backend to skip its caches. */
export function useRefresh(prerelease: boolean): () => void {
  const bridge = useBridge();
  const queries = useQueryClient();
  return useCallback(() => {
    void queries.invalidateQueries({ queryKey: queryKeys.installed });
    void queries.invalidateQueries({ queryKey: ["search"] });
    void queries.invalidateQueries({ queryKey: ["details"] });
    void queries
      .fetchQuery({
        queryKey: queryKeys.updates(prerelease),
        queryFn: () => bridge.backend("packageUpdates", { prerelease, noCache: true }),
        staleTime: 0
      })
      .catch(() => {});
  }, [bridge, queries, prerelease]);
}
