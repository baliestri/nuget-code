import { LogLevels, type LogEntry, type LogLevel } from "@nuget-code/protocol";

/** How many entries the view keeps. */
export const LOG_CAPACITY = 5000;

/** The newest entries, up to a capacity; the oldest are dropped to make room. */
export class LogBuffer {
  private items: LogEntry[] = [];

  constructor(private readonly capacity: number) {}

  get size(): number {
    return this.items.length;
  }

  push(entry: LogEntry): void {
    this.items.push(entry);
    if (this.items.length > this.capacity) {
      this.items.splice(0, this.items.length - this.capacity);
    }
  }

  clear(): void {
    this.items = [];
  }

  /** The entries of the given levels, oldest first. */
  entries(levels: ReadonlySet<LogLevel>): readonly LogEntry[] {
    return this.items.filter((entry) => levels.has(entry.level));
  }
}

/** Five letters each, so that the messages line up. */
const LEVEL_CODES: Record<LogLevel, string> = {
  [LogLevels.debug]: "DEBUG",
  [LogLevels.verbose]: "VERBO",
  [LogLevels.info]: "INFOR",
  [LogLevels.warning]: "WARNI",
  [LogLevels.error]: "ERROR"
};

export interface LineOptions {
  time: boolean;
  context: boolean;
  level: boolean;
}

/** The time of day of an entry, as the backend wrote it: its clock, not this machine's. */
function timeOf(entry: LogEntry): string {
  return /T(\d{2}:\d{2}:\d{2})/.exec(entry.time)?.[1] ?? entry.time;
}

/** One entry as a line: `16:08:13|NUGET|DEBUG| message`, with only the columns asked for. */
export function formatLine(entry: LogEntry, options: LineOptions): string {
  const columns = [
    ...(options.time ? [timeOf(entry)] : []),
    ...(options.context ? [entry.context] : []),
    ...(options.level ? [LEVEL_CODES[entry.level]] : [])
  ];
  return columns.length === 0 ? entry.message : `${columns.join("|")}| ${entry.message}`;
}

/** Whether a list scrolled to this position is at its end, give or take a few pixels: new lines keep it there. */
export function shouldFollow(scrollTop: number, clientHeight: number, scrollHeight: number, slack = 8): boolean {
  return scrollHeight - (scrollTop + clientHeight) <= slack;
}
