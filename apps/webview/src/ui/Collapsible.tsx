import { useId, useState, type ReactNode } from "react";

interface CollapsibleProps {
  /** What the header says; also the name of the button that opens and closes the section. */
  title: ReactNode;
  /** Shown on the header's line, after the title. Not part of the button. */
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

/** A section whose content can be hidden. */
export function Collapsible({ title, summary, defaultOpen = true, children }: CollapsibleProps): ReactNode {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section>
      <div className="flex min-w-0 items-baseline gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
          className="flex shrink-0 items-center gap-1 font-semibold"
        >
          <i className={`codicon codicon-chevron-${open ? "down" : "right"}`} aria-hidden="true" />
          {title}
        </button>
        {summary === undefined ? null : <span className="text-muted min-w-0 truncate">{summary}</span>}
      </div>
      <div id={id} hidden={!open} className="pt-1 pl-5">
        {children}
      </div>
    </section>
  );
}
