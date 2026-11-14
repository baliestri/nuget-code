import type { ReactNode } from "react";

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary";
  type?: "button" | "submit";
}

export function Button({
  children,
  onClick,
  disabled = false,
  variant = "primary",
  type = "button"
}: ButtonProps): ReactNode {
  const colours =
    variant === "primary" ? "bg-accent text-accent-fg hover:bg-accent-hover" : "bg-secondary text-secondary-fg";
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`rounded px-3 py-1 ${colours} disabled:cursor-default disabled:opacity-40`}
    >
      {children}
    </button>
  );
}
