import type { PackageSummary } from "@nuget-code/protocol";
import type { ReactNode } from "react";
import { Placeholder } from "../app/Placeholder";
import { PackageGroup, PackageLine } from "./PackageList";
import { SEARCH_SIZE } from "./queries";

interface DiscoverViewProps {
  packages: readonly PackageSummary[] | undefined;
  loading: boolean;
  /** Why the search failed, when it did. */
  error: string | undefined;
  selectedId: string | undefined;
  onSelect(id: string): void;
  /** Asks for the menu of a package, at a place in the window. */
  onMenu(id: string, at: { x: number; y: number }): void;
}

/** The Discover list: what the feeds answer to the search. */
export function DiscoverView(props: DiscoverViewProps): ReactNode {
  if (props.error !== undefined) {
    return <Placeholder title="The search failed">{props.error}</Placeholder>;
  }

  if (props.packages === undefined) {
    return <Placeholder title="Searching…" />;
  }

  if (props.packages.length === 0) {
    return <Placeholder title="No packages found" />;
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pt-1">
      <PackageGroup title={`Available Packages: Top ${SEARCH_SIZE}`} loading={props.loading}>
        {props.packages.map((item) => (
          <PackageLine
            key={`${item.feed}/${item.id}`}
            id={item.id}
            latest={item.version}
            iconUrl={item.iconUrl}
            selected={props.selectedId?.toLowerCase() === item.id.toLowerCase()}
            onSelect={() => props.onSelect(item.id)}
            onMenu={(at) => props.onMenu(item.id, at)}
          />
        ))}
      </PackageGroup>
    </div>
  );
}
