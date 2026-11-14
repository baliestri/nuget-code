import type { ReactNode } from "react";
import { Placeholder } from "../app/Placeholder";
import { Button } from "../ui/Button";
import type { PackageRow } from "./model";
import { PackageGroup, PackageLine } from "./PackageList";

interface InstalledViewProps {
  /** The installed packages of the target, already filtered and ordered. */
  rows: readonly PackageRow[];
  /** The name of the target, as the group titles say it: "Solution" or a project. */
  targetName: string;
  loading: boolean;
  updatesLoading: boolean;
  selectedId: string | undefined;
  onSelect(id: string): void;
  /** Asks for the menu of a package, at a place in the window. */
  onMenu(id: string, at: { x: number; y: number }): void;
  /** The ids ticked in the update group. */
  checked: ReadonlySet<string>;
  onCheck(ids: ReadonlySet<string>): void;
  onUpdate(): void;
  /** An operation is running: nothing can be started. */
  busy: boolean;
  iconOf(id: string): string | undefined;
}

function reasonNotRestored(row: PackageRow): string {
  const projects = row.projects.filter((use) => !use.restored).map((use) => use.name);
  return `Not restored in ${projects.join(", ")}. Run Restore, or see the Log for why the last restore failed.`;
}

/** The Installed list: the packages that have a newer version, to tick and update, then every package. */
export function InstalledView(props: InstalledViewProps): ReactNode {
  const { rows, checked } = props;
  if (props.loading) {
    return <Placeholder title="Loading the installed packages…" />;
  }

  const outdated = rows.filter((row) => row.hasUpdate);
  const tickedCount = outdated.filter((row) => checked.has(row.id)).length;
  const toggle = (id: string, on: boolean): void => {
    const next = new Set(checked);
    if (on) {
      next.add(id);
    } else {
      next.delete(id);
    }

    props.onCheck(next);
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pt-1">
      {outdated.length === 0 ? null : (
        <PackageGroup
          title={`Packages to Update in ${props.targetName}: ${outdated.length}`}
          loading={props.updatesLoading}
          selectAll={{
            checked: tickedCount === outdated.length,
            indeterminate: tickedCount > 0 && tickedCount < outdated.length,
            disabled: props.busy,
            onChange: (on) => props.onCheck(new Set(on ? outdated.map((row) => row.id) : []))
          }}
          action={
            <Button onClick={props.onUpdate} disabled={props.busy || tickedCount === 0}>
              Update
            </Button>
          }
        >
          {outdated.map((row) => (
            <PackageLine
              key={row.id}
              id={row.id}
              versions={row.versions.join(", ")}
              latest={row.latest}
              iconUrl={props.iconOf(row.id)}
              selected={props.selectedId === row.id}
              onSelect={() => props.onSelect(row.id)}
              onMenu={(at) => props.onMenu(row.id, at)}
              check={{ checked: checked.has(row.id), disabled: props.busy, onChange: (on) => toggle(row.id, on) }}
            />
          ))}
        </PackageGroup>
      )}
      <PackageGroup title={`Installed Packages in ${props.targetName}: ${rows.length}`} loading={props.updatesLoading}>
        {rows.map((row) => (
          <PackageLine
            key={row.id}
            id={row.id}
            versions={row.versions.join(", ")}
            latest={row.hasUpdate ? row.latest : undefined}
            iconUrl={props.iconOf(row.id)}
            selected={props.selectedId === row.id}
            onSelect={() => props.onSelect(row.id)}
            onMenu={(at) => props.onMenu(row.id, at)}
            dimmed={row.implicit}
            warning={row.restored || row.implicit ? undefined : reasonNotRestored(row)}
          />
        ))}
      </PackageGroup>
    </div>
  );
}
