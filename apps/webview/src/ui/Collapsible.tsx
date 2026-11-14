import { useId, useState, type ReactNode } from "react";

interface CollapsibleProps {
  /** What the header says; also the name of the button that opens and closes the section. */
  title: ReactNode;
  /** Shown on the header's line, after the title. Not part of the button. */
  summary?: ReactNode;
  defaultOpen?: boolean;
  /** When given, whoever uses the section decides whether it is open, and hears when the header is clicked. */
  open?: boolean | undefined;
  onToggle?: ((open: boolean) => void) | undefined;
  children: ReactNode;
}

/** A section whose content can be hidden. */
export function Collapsible(props: CollapsibleProps): ReactNode {
  const { title, summary, defaultOpen = true, children } = props;
  const [own, setOwn] = useState(defaultOpen);
  const open = props.open ?? own;
  const id = useId();
  return (
    <section>
      <div className="flex min-w-0 items-baseline gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => {
            setOwn(!open);
            props.onToggle?.(!open);
          }}
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
