import {
  EventEmitter,
  window,
  type Disposable,
  type OutputChannel,
} from "vscode";
import type { LogEntry, LogLevel } from "#contracts/logging";
import type { ExtensionSettings } from "#extension/settings";

export class ExtensionLogger implements Disposable {
  private readonly output: OutputChannel;
  private readonly entries: LogEntry[] = [];
  private readonly didLog = new EventEmitter<LogEntry>();
  private nextId = 1;
  private settings: ExtensionSettings;

  readonly onDidLog = this.didLog.event;

  constructor(settings: ExtensionSettings) {
    this.settings = settings;
    this.output = window.createOutputChannel("NuGet Package Manager");
  }

  updateSettings(settings: ExtensionSettings): void {
    this.settings = settings;
    this.trim();
  }

  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries.length = 0;
    this.output.clear();
  }

  debug(context: string, message: string): void {
    this.log(context, "debug", message);
  }

  verbose(context: string, message: string): void {
    this.log(context, "verbose", message);
  }

  information(context: string, message: string): void {
    this.log(context, "information", message);
  }

  minimal(context: string, message: string): void {
    this.log(context, "minimal", message);
  }

  warning(context: string, message: string): void {
    this.log(context, "warning", message);
  }

  error(context: string, message: string): void {
    this.log(context, "error", message);
  }

  log(context: string, level: LogLevel, message: string): void {
    const timestamp = new Date().toISOString();
    const formatted = `${timestamp}|${context}|${level}| ${message}`;
    const entry: LogEntry = {
      id: this.nextId++,
      timestamp,
      context,
      level,
      message,
      formatted,
    };

    this.entries.push(entry);
    this.trim();
    this.output.appendLine(formatted);
    this.didLog.fire(entry);
  }

  dispose(): void {
    this.didLog.dispose();
    this.output.dispose();
  }

  private trim(): void {
    const overflow = this.entries.length - this.settings.maxLogEntries;
    if (overflow > 0) {
      this.entries.splice(0, overflow);
    }
  }
}
