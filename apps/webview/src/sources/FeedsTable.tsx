import type { FeedInfo } from "@nuget-code/protocol";
import type { ReactNode } from "react";
import { Checkbox } from "../ui/Checkbox";
import { IconButton } from "../ui/IconButton";

interface FeedsTableProps {
  feeds: readonly FeedInfo[];
  /** Whether the feed's declaration can be changed: its file is writable. */
  canEdit(feed: FeedInfo): boolean;
  /** Whether the feed can be enabled and disabled; true for a machine-wide feed even when it cannot be edited. */
  canToggle(feed: FeedInfo): boolean;
  /** Whether a feed can be added here. */
  canAdd: boolean;
  onEnabled(feed: FeedInfo, enabled: boolean): void;
  onAllowInsecure(feed: FeedInfo, allow: boolean): void;
  onEdit(feed: FeedInfo): void;
  onRemove(feed: FeedInfo): void;
  onAdd(): void;
}

const CELL = "border-border border-b px-2 py-1";
const HEAD = `${CELL} text-center font-normal`;

/** The feeds of a file, or of every file combined, with what can be changed about each. */
export function FeedsTable(props: FeedsTableProps): ReactNode {
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th scope="col" className={HEAD}>
            Name
          </th>
          <th scope="col" className={HEAD}>
            URL
          </th>
          <th scope="col" className={`${HEAD} w-px whitespace-nowrap`}>
            Allow insecure
          </th>
          <th scope="col" className={`${HEAD} w-px`}>
            Enabled
          </th>
          <th scope="col" className={`${HEAD} w-px`}>
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {props.feeds.map((feed) => {
          const editable = props.canEdit(feed);
          return (
            <tr key={`${feed.declaredIn ?? ""}/${feed.name}`} className="hover:bg-hover">
              <th scope="row" className={`${CELL} text-left font-normal whitespace-nowrap`}>
                {feed.name}
              </th>
              <td className={`${CELL} break-all`}>{feed.source}</td>
              <td className={`${CELL} text-center`}>
                <Checkbox
                  label={`Allow insecure connections: ${feed.name}`}
                  checked={feed.allowInsecureConnections}
                  disabled={!editable}
                  onChange={(allow) => props.onAllowInsecure(feed, allow)}
                />
              </td>
              <td className={`${CELL} text-center`}>
                <Checkbox
                  label={`Enabled: ${feed.name}`}
                  checked={feed.enabled}
                  disabled={!props.canToggle(feed)}
                  onChange={(enabled) => props.onEnabled(feed, enabled)}
                />
              </td>
              <td className={CELL}>
                {editable ? (
                  <div className="flex gap-1">
                    <IconButton icon="edit" label={`Edit ${feed.name}`} onClick={() => props.onEdit(feed)} />
                    <IconButton icon="trash" label={`Remove ${feed.name}`} onClick={() => props.onRemove(feed)} />
                  </div>
                ) : null}
              </td>
            </tr>
          );
        })}
        {props.canAdd ? (
          <tr>
            <td className={`${CELL} text-muted italic`}>New feed</td>
            <td className={`${CELL} text-muted italic`}>https://</td>
            <td className={CELL} />
            <td className={CELL} />
            <td className={CELL}>
              <IconButton icon="add" label="Add a feed" onClick={props.onAdd} />
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}
