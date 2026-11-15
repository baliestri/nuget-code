import type { ReactNode } from "react";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  /** Shown as the option's tooltip. */
  title?: string;
}

interface SelectProps {
  /** The accessible name. */
  label: string;
  value: string;
  options: readonly SelectOption[];
  onChange(value: string): void;
  disabled?: boolean;
  className?: string;
}

/** A drop-down list. The editor's own list control is used, so it follows the platform and the keyboard. */
export function Select({ label, value, options, onChange, disabled = false, className = "" }: SelectProps): ReactNode {
  return (
    <select
      aria-label={label}
      title={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className={`border-input-border bg-input text-input-fg min-w-0 rounded border px-1 py-0.5 ${className}`}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled} title={option.title}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
