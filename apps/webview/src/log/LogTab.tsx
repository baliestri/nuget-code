import { LogLevels, type LogLevel } from "@nuget-code/protocol";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { SideBar } from "../app/SideBar";
import { usePreferences } from "../state/PreferencesContext";
import { Checkbox } from "../ui/Checkbox";
import { IconButton } from "../ui/IconButton";
import { LogList, type LogListHandle } from "./LogList";
import { useLog } from "./LogStore";

const LEVELS = Object.values(LogLevels);
const LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevels.debug]: "Debug",
  [LogLevels.verbose]: "Verbose",
  [LogLevels.info]: "Info",
  [LogLevels.warning]: "Warning",
  [LogLevels.error]: "Error"
};

function levelSummary(shown: readonly LogLevel[]): string {
  if (shown.length === LEVELS.length) {
    return "All";
  }

  return shown.length === 0 ? "None" : shown.map((level) => LEVEL_NAMES[level]).join(", ");
}

/** The button that opens the list of levels, each with a box: any number of them can be shown. */
function LevelFilter({
  shown,
  onChange
}: {
  shown: readonly LogLevel[];
  onChange(levels: LogLevel[]): void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const close = (event: PointerEvent): void => {
      if (root.current !== null && !root.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div
      ref={root}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="border-input-border hover:bg-toolbar-hover flex items-center gap-1 rounded border px-1.5 py-0.5"
      >
        Level: {levelSummary(shown)}
        <i className="codicon codicon-chevron-down" aria-hidden="true" />
      </button>
      <div
        id={id}
        role="group"
        aria-label="Levels shown"
        hidden={!open}
        className="border-input-border bg-input text-input-fg absolute top-full left-0 z-20 mt-1 flex flex-col gap-1 rounded border px-2 py-1.5 shadow-lg"
      >
        {LEVELS.map((level) => (
          <Checkbox
            key={level}
            checked={shown.includes(level)}
            // Kept in the order of severity, whatever the order of the clicks.
            onChange={(on) => onChange(LEVELS.filter((item) => (item === level ? on : shown.includes(item))))}
          >
            {LEVEL_NAMES[level]}
          </Checkbox>
        ))}
      </div>
    </div>
  );
}

/** The Log tab: what the backend and NuGet said since the view opened. */
export function LogTab(): ReactNode {
  const { preferences, setLog } = usePreferences();
  // Reading the store this way renders the tab again whenever the log changes.
  const { store } = useLog();
  const list = useRef<LogListHandle>(null);
  const { time, context, level, wrap, levels } = preferences.log;
  const entries = store.buffer.entries(new Set(levels));

  return (
    <>
      <SideBar>
        <IconButton icon="refresh" label="Reload" onClick={() => store.clear()} />
      </SideBar>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div role="toolbar" aria-label="Log" className="flex shrink-0 items-center gap-1 px-2 py-1">
          <IconButton icon="watch" label="Show Time" pressed={time} onClick={() => setLog({ time: !time })} />
          <IconButton
            icon="symbol-namespace"
            label="Show Context"
            pressed={context}
            onClick={() => setLog({ context: !context })}
          />
          <IconButton icon="tag" label="Show Level" pressed={level} onClick={() => setLog({ level: !level })} />
          <span className="bg-border mx-1 h-4 w-px" aria-hidden="true" />
          <IconButton icon="word-wrap" label="Soft-Wrap" pressed={wrap} onClick={() => setLog({ wrap: !wrap })} />
          <IconButton icon="arrow-down" label="Scroll to End" onClick={() => list.current?.scrollToEnd()} />
          <IconButton icon="clear-all" label="Clear All" onClick={() => store.clear()} />
          <span className="bg-border mx-1 h-4 w-px" aria-hidden="true" />
          <LevelFilter shown={levels} onChange={(next) => setLog({ levels: next })} />
          <span className="text-muted ml-auto">
            {entries.length === store.buffer.size
              ? `${entries.length} lines`
              : `${entries.length} of ${store.buffer.size} lines`}
          </span>
        </div>
        <LogList ref={list} entries={entries} options={{ time, context, level }} wrap={wrap} />
      </div>
    </>
  );
}
