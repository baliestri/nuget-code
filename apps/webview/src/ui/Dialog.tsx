import { useEffect, useId, type ReactNode } from "react";

interface DialogProps {
  title: string;
  /** Called when the user gives up: Escape, or a click outside the dialog. */
  onClose(): void;
  children: ReactNode;
}

/** A panel over the view that has to be answered before anything else. */
export function Dialog({ title, onClose, children }: DialogProps): ReactNode {
  const id = useId();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="bg-bg/70 fixed inset-0 z-30 flex items-center justify-center p-4"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className="border-border bg-surface flex max-h-full w-full max-w-lg flex-col gap-3 overflow-y-auto rounded border p-4 shadow-lg"
      >
        <h2 id={id} className="font-semibold">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
