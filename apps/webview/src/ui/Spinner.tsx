import type { ReactNode } from "react";

/** Says that something is loading. `label` is what a screen reader announces. */
export function Spinner({ label = "Loading" }: { label?: string }): ReactNode {
  return (
    <span role="status" aria-label={label} className="text-muted inline-flex">
      <i className="codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />
    </span>
  );
}
