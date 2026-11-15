import type { ReactNode } from "react";

/** A button that reads as a link: for an action inside a sentence. */
export function LinkButton({ children, onClick }: { children: ReactNode; onClick: () => void }): ReactNode {
  return (
    <button type="button" onClick={onClick} className="text-link cursor-pointer hover:underline">
      {children}
    </button>
  );
}
