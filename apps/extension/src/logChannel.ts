import { LogLevels, type LogEntry, type LogLevel } from "@nuget-code/protocol";

/** The context of lines written by the extension host itself, next to the backend's `NUGET` and `VSCODE`. */
export const HOST_CONTEXT = "HOST";

const ORDER: readonly LogLevel[] = Object.values(LogLevels);

/** Whether an entry of the level is written when `minimum` is the least severe level wanted. */
export function shouldLog(level: LogLevel, minimum: LogLevel): boolean {
  return ORDER.indexOf(level) >= ORDER.indexOf(minimum);
}

/** One line of the output channel: `12:34:56.789 [warning] [NUGET] message`. */
export function formatEntry(entry: { level: string; time: string; context: string; message: string }): string {
  return `${timeOf(entry.time)} [${entry.level}] [${entry.context}] ${entry.message}`;
}

function timeOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  const pad = (value: number, width = 2): string => String(value).padStart(width, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

/** What the channel needs from a VS Code output channel. */
export interface OutputSink {
  appendLine(line: string): void;
  show(preserveFocus?: boolean): void;
}

/**
 * The "NuGet" output channel. The backend sends every level; `minimum`, the `nuget.log.level` setting, is
 * the one filter between it and the channel.
 */
export class LogChannel {
  minimum: LogLevel;

  constructor(
    private readonly sink: OutputSink,
    minimum: LogLevel,
    private readonly now: () => Date = () => new Date()
  ) {
    this.minimum = minimum;
  }

  /** An entry from the backend. */
  write(entry: LogEntry): void {
    if (shouldLog(entry.level, this.minimum)) {
      this.sink.appendLine(formatEntry(entry));
    }
  }

  /** A line from the extension host: its own messages and what the backend process prints to stderr. */
  host(level: LogLevel, message: string): void {
    const text = message.trimEnd();
    if (text !== "" && shouldLog(level, this.minimum)) {
      this.sink.appendLine(
        formatEntry({ level, time: this.now().toISOString(), context: HOST_CONTEXT, message: text })
      );
    }
  }

  show(): void {
    this.sink.show(true);
  }
}
