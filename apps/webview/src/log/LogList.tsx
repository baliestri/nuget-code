import { LogLevels, type LogEntry, type LogLevel } from "@nuget-code/protocol";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useImperativeHandle, useRef, type ReactNode, type Ref } from "react";
import { formatLine, shouldFollow, type LineOptions } from "./logBuffer";

const COLOURS: Record<LogLevel, string> = {
  [LogLevels.debug]: "",
  [LogLevels.verbose]: "text-muted",
  [LogLevels.info]: "text-info",
  [LogLevels.warning]: "text-warning",
  [LogLevels.error]: "text-error"
};

const LINE_HEIGHT = 18;
/** How many of the newest lines are drawn while the list has no height to measure, as when its panel is hidden. */
const UNMEASURED_TAIL = 200;

export interface LogListHandle {
  /** Goes to the newest line and keeps following new ones. */
  scrollToEnd(): void;
}

interface LogListProps {
  entries: readonly LogEntry[];
  options: LineOptions;
  wrap: boolean;
  ref?: Ref<LogListHandle>;
}

/**
 * The lines of the log. Only the ones in sight are in the document. It stays at the end as lines arrive,
 * until the user scrolls away from it; scrolling back to the end, or asking for it, follows again.
 */
export function LogList({ entries, options, wrap, ref }: LogListProps): ReactNode {
  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  // The rule is about the React Compiler memoizing what this hook returns; the view is not compiled with it.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => LINE_HEIGHT,
    overscan: 20
  });

  const toEnd = (): void => {
    if (entries.length > 0) {
      virtualizer.scrollToIndex(entries.length - 1, { align: "end" });
    }
  };
  useImperativeHandle(ref, () => ({
    scrollToEnd: () => {
      following.current = true;
      toEnd();
    }
  }));
  // After the new lines are laid out, so that the end is the new end.
  useEffect(() => {
    if (following.current) {
      toEnd();
    }
  });

  const measured = (virtualizer.scrollRect?.height ?? 0) > 0;
  const line = (entry: LogEntry): string => formatLine(entry, options);
  const lineClass = `font-mono px-2 ${wrap ? "break-all whitespace-pre-wrap" : "whitespace-pre"}`;

  return (
    <div
      ref={scroller}
      role="log"
      aria-label="NuGet log"
      tabIndex={0}
      onScroll={(event) => {
        const { scrollTop, clientHeight, scrollHeight } = event.currentTarget;
        following.current = shouldFollow(scrollTop, clientHeight, scrollHeight);
      }}
      className="min-h-0 flex-1 overflow-auto select-text"
    >
      {measured ? (
        <div
          className={`relative ${wrap ? "w-full" : "w-max min-w-full"}`}
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const entry = entries[item.index]!;
            return (
              <div
                key={item.key}
                data-index={item.index}
                ref={wrap ? virtualizer.measureElement : undefined}
                className={`absolute top-0 left-0 ${wrap ? "w-full" : ""} ${lineClass} ${COLOURS[entry.level]}`}
                style={{ transform: `translateY(${item.start}px)`, ...(wrap ? {} : { height: item.size }) }}
              >
                {line(entry)}
              </div>
            );
          })}
        </div>
      ) : (
        entries.slice(-UNMEASURED_TAIL).map((entry, index) => (
          // The position is stable for as long as this list is shown: it is drawn again whole on each change.
          <div key={index} className={`${lineClass} ${COLOURS[entry.level]}`}>
            {line(entry)}
          </div>
        ))
      )}
    </div>
  );
}
