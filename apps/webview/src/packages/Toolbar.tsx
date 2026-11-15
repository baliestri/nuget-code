import type { FeedInfo } from "@nuget-code/protocol";
import type { ReactNode } from "react";
import { assetUrl, projectIconUrl } from "../lib/assets";
import { Checkbox } from "../ui/Checkbox";
import { Dropdown } from "../ui/Dropdown";
import type { TargetOption } from "./model";

const SOLUTION = "\u0000solution";
const ALL_FEEDS = "\u0000all";
const MANAGE_FEEDS = "\u0000manage";

interface ToolbarProps {
  search: string;
  onSearch(text: string): void;
  targets: readonly TargetOption[];
  target: string | null;
  onTarget(target: string | null): void;
  feeds: readonly FeedInfo[];
  feed: string | null;
  onFeed(feed: string | null): void;
  onManageFeeds(): void;
  prerelease: boolean;
  onPrerelease(prerelease: boolean): void;
}

function targetLabel(option: TargetOption): string {
  if (option.count === undefined) {
    return option.label;
  }

  return `${option.label} (${option.count} ${option.count === 1 ? "package" : "packages"})`;
}

/** The icon of a solution or project file; a generic one for a kind the bundle has no icon for. */
function FileIcon({ url }: { url: string | undefined }): ReactNode {
  return url === undefined ? (
    <i className="codicon codicon-file-code text-muted shrink-0" aria-hidden="true" />
  ) : (
    <img src={url} alt="" width={16} height={16} className="h-4 w-4 shrink-0" />
  );
}

/** The line above the package lists: what to search for, in which project, on which feed. */
export function Toolbar(props: ToolbarProps): ReactNode {
  const enabledFeeds = props.feeds.filter((feed) => feed.enabled);
  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
      <div className="border-input-border bg-input flex min-w-0 flex-1 items-center gap-1 rounded border px-1.5">
        <i className="codicon codicon-search text-muted" aria-hidden="true" />
        <input
          type="search"
          aria-label="Search packages"
          value={props.search}
          onChange={(event) => props.onSearch(event.target.value)}
          className="text-input-fg min-w-0 flex-1 bg-transparent py-0.5 outline-none"
        />
      </div>
      <Dropdown
        label="Target"
        value={props.target ?? SOLUTION}
        onChange={(value) => props.onTarget(value === SOLUTION ? null : value)}
        options={props.targets.map((option) => ({
          value: option.value ?? SOLUTION,
          label: targetLabel(option),
          short: option.label,
          icon: <FileIcon url={option.value === null ? assetUrl("sln.svg") : projectIconUrl(option.value)} />,
          ...(option.error === undefined ? {} : { disabled: true, title: option.error })
        }))}
        className="max-w-56"
      />
      <Dropdown
        label="Feed"
        value={props.feed ?? ALL_FEEDS}
        onChange={(value) => {
          if (value === MANAGE_FEEDS) {
            props.onManageFeeds();
          } else {
            props.onFeed(value === ALL_FEEDS ? null : value);
          }
        }}
        options={[
          { value: ALL_FEEDS, label: "All feeds" },
          ...enabledFeeds.map((feed) => ({ value: feed.name, label: feed.name })),
          { value: MANAGE_FEEDS, label: "Manage Feeds…" }
        ]}
        className="max-w-40"
      />
      <Checkbox checked={props.prerelease} onChange={props.onPrerelease}>
        Prerelease
      </Checkbox>
    </div>
  );
}
