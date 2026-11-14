import type { ReactNode } from "react";

const ICONS = { info: "info", warning: "warning", error: "error" } as const;
const COLOURS = { info: "text-info", warning: "text-warning", error: "text-error" } as const;

interface BannerProps {
  kind: keyof typeof ICONS;
  children: ReactNode;
  /** Buttons shown after the text. */
  actions?: ReactNode;
}

/** A line that tells the user something happened or needs attention. Errors are announced at once. */
export function Banner({ kind, children, actions }: BannerProps): ReactNode {
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className="border-border bg-surface flex items-start gap-2 border-b px-3 py-1.5"
    >
      <i className={`codicon codicon-${ICONS[kind]} ${COLOURS[kind]} mt-0.5`} aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
      {actions === undefined ? null : <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  );
}
