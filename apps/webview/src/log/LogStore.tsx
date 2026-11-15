import type { LogEntry } from "@nuget-code/protocol";
import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";
import { useBridgeEvent } from "../bridge/BridgeContext";
import { LOG_CAPACITY, LogBuffer } from "./logBuffer";

/** The log entries received since the view opened, and a way to hear that they changed. */
export class LogStore {
  readonly buffer = new LogBuffer(LOG_CAPACITY);
  private version = 0;
  private notifying = false;
  private readonly listeners = new Set<() => void>();

  push(entry: LogEntry): void {
    this.buffer.push(entry);
    this.changed();
  }

  clear(): void {
    this.buffer.clear();
    this.changed();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** A number that is different after every change. */
  getVersion = (): number => this.version;

  // Entries come in bursts; the listeners hear once for each burst.
  private changed(): void {
    this.version++;
    if (!this.notifying) {
      this.notifying = true;
      queueMicrotask(() => {
        this.notifying = false;
        this.listeners.forEach((listener) => listener());
      });
    }
  }
}

const LogContext = createContext<LogStore | undefined>(undefined);

/** Collects the log from the moment the view opens, whichever tab is shown. */
export function LogProvider({ children }: { children: ReactNode }): ReactNode {
  const [store] = useState(() => new LogStore());
  useBridgeEvent("logEntry", (entry) => store.push(entry));
  return <LogContext value={store}>{children}</LogContext>;
}

/** The store, and its version: a component that reads it is rendered again when the log changes. */
export function useLog(): { store: LogStore; version: number } {
  const store = useContext(LogContext);
  if (store === undefined) {
    throw new Error("useLog needs a LogProvider above it.");
  }

  return { store, version: useSyncExternalStore(store.subscribe, store.getVersion) };
}
