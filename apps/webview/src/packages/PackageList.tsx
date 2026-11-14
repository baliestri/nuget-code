import { useId, useState, type ReactNode } from "react";
import { Checkbox } from "../ui/Checkbox";
import { Spinner } from "../ui/Spinner";
import { PackageIcon } from "./PackageIcon";

interface GroupProps {
  title: string;
  /** Shows that the list may still change. */
  loading?: boolean;
  /** A box before the title, for selecting every line of the group. */
  selectAll?: { checked: boolean; indeterminate: boolean; onChange(checked: boolean): void; disabled: boolean };
  /** Shown at the right of the header. */
  action?: ReactNode;
  children: ReactNode;
}

/** A titled block of package lines that can be folded away. */
export function PackageGroup({ title, loading = false, selectAll, action, children }: GroupProps): ReactNode {
  const [open, setOpen] = useState(true);
  const id = useId();
  return (
    <section className="bg-surface mx-2 mb-2 rounded">
      <header className="flex items-center gap-2 px-2 py-1.5">
        {selectAll === undefined ? null : (
          <Checkbox
            label={`Select all: ${title}`}
            checked={selectAll.checked}
            indeterminate={selectAll.indeterminate}
            disabled={selectAll.disabled}
            onChange={selectAll.onChange}
          />
        )}
        <h2 className="font-semibold">{title}</h2>
        {loading ? <Spinner label={`Loading: ${title}`} /> : null}
        <div className="flex-1" />
        {action}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          aria-label={`${open ? "Collapse" : "Expand"}: ${title}`}
          onClick={() => setOpen(!open)}
          className="hover:bg-toolbar-hover flex h-5 w-5 items-center justify-center rounded"
        >
          <i className={`codicon codicon-chevron-${open ? "up" : "down"}`} aria-hidden="true" />
        </button>
      </header>
      <ul id={id} hidden={!open} className="pb-1">
        {children}
      </ul>
    </section>
  );
}

interface LineProps {
  id: string;
  /** What follows the id after a bullet: the versions in use. */
  versions?: string | undefined;
  /** Shown at the right, in the colour of a link: the version one would move to. */
  latest?: string | undefined;
  iconUrl?: string | undefined;
  selected: boolean;
  onSelect(): void;
  /** A selection box before the line. */
  check?: { checked: boolean; onChange(checked: boolean): void; disabled: boolean } | undefined;
  /** Shown dimmed: the package is there, but nothing can be done to it. */
  dimmed?: boolean;
  /** A warning shown after the id, with this explanation. */
  warning?: string | undefined;
}

/** One package in a list. The line is a button that shows the package's details. */
export function PackageLine(props: LineProps): ReactNode {
  return (
    <li
      className={`flex items-center gap-2 px-2 ${props.selected ? "bg-selection text-selection-fg" : "hover:bg-hover"}`}
    >
      {props.check === undefined ? null : (
        <Checkbox
          label={`Select ${props.id}`}
          checked={props.check.checked}
          disabled={props.check.disabled}
          onChange={props.check.onChange}
        />
      )}
      <button
        type="button"
        aria-pressed={props.selected}
        onClick={props.onSelect}
        className={`flex min-w-0 flex-1 items-center gap-2 py-0.5 text-left ${props.dimmed === true ? "opacity-60" : ""}`}
      >
        <PackageIcon url={props.iconUrl} />
        <span className="min-w-0 truncate">
          {props.id}
          {props.versions === undefined ? null : (
            <>
              {" "}
              <span className="text-muted">• {props.versions}</span>
            </>
          )}
        </span>
        {props.warning === undefined ? null : (
          <i
            role="img"
            aria-label={props.warning}
            title={props.warning}
            className="codicon codicon-warning text-warning shrink-0"
          />
        )}
      </button>
      {props.latest === undefined ? null : <span className="text-link shrink-0">{props.latest}</span>}
    </li>
  );
}
