export type LogLevel =
  | "debug"
  | "verbose"
  | "information"
  | "minimal"
  | "warning"
  | "error";

export interface LogEntry {
  id: number;
  timestamp: string;
  context: string;
  level: LogLevel;
  message: string;
  formatted: string;
}
