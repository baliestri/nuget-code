export interface Timers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const systemTimers: Timers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout)
};

/**
 * Collects changed paths and hands them over together, once nothing new has arrived for `delayMs`. A save
 * that touches several files, or an editor that writes a file twice, becomes one report.
 */
export class ChangeBatcher {
  private readonly pending = new Set<string>();
  private timer: unknown;

  constructor(
    private readonly delayMs: number,
    private readonly flush: (paths: string[]) => void,
    private readonly timers: Timers = systemTimers
  ) {}

  add(path: string): void {
    this.pending.add(path);
    this.timers.clearTimeout(this.timer);
    this.timer = this.timers.setTimeout(() => {
      const paths = [...this.pending];
      this.pending.clear();
      this.flush(paths);
    }, this.delayMs);
  }

  /** Drops what was waiting to be sent. */
  dispose(): void {
    this.timers.clearTimeout(this.timer);
    this.pending.clear();
  }
}
