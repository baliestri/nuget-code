import type { ReactNode } from "react";

interface IconButtonProps {
  /** A codicon name, without the `codicon-` prefix. */
  icon: string;
  /** What the button does: its accessible name and its tooltip. */
  label: string;
  onClick?: (() => void) | undefined;
  disabled?: boolean;
  /** For a button that is a toggle: whether it is on. */
  pressed?: boolean | undefined;
}

/** A button that shows only an icon. */
export function IconButton({ icon, label, onClick, disabled = false, pressed }: IconButtonProps): ReactNode {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`text-fg hover:bg-toolbar-hover flex h-6 w-6 shrink-0 items-center justify-center rounded disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent ${
        pressed === true ? "bg-toolbar-hover" : ""
      }`}
    >
      <i className={`codicon codicon-${icon}`} aria-hidden="true" />
    </button>
  );
}
