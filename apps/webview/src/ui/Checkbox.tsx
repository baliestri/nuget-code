import { useEffect, useRef, type ReactNode } from "react";

interface CheckboxProps {
  checked: boolean;
  onChange(checked: boolean): void;
  /** The accessible name, for a box that has no visible label next to it. */
  label?: string;
  /** Some, but not all, of what the box stands for is checked. */
  indeterminate?: boolean;
  disabled?: boolean;
  children?: ReactNode;
}

export function Checkbox({
  checked,
  onChange,
  label,
  indeterminate = false,
  disabled = false,
  children
}: CheckboxProps): ReactNode {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (input.current !== null) {
      input.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  const box = (
    <input
      ref={input}
      type="checkbox"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
      className="accent-accent h-3.5 w-3.5 shrink-0"
    />
  );
  return children === undefined ? (
    box
  ) : (
    <label className="flex items-center gap-1.5">
      {box}
      {children}
    </label>
  );
}
