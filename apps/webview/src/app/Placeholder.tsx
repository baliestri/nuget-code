import type { ReactNode } from "react";

/** What a part of the view shows when it has nothing to list: a title and what to do about it. */
export function Placeholder({ title, children }: { title: string; children?: ReactNode }): ReactNode {
  return (
    <div className="text-muted flex h-full flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
      <p className="text-fg">{title}</p>
      {children}
    </div>
  );
}
