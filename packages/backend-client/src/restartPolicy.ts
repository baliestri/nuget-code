/**
 * Decides whether a crashed backend is started again: up to `limit - 1` crashes inside the window are
 * followed by a restart, and the crash that reaches the limit is not.
 */
export class RestartPolicy {
  private crashes: number[] = [];

  constructor(
    private readonly limit = 3,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now
  ) {}

  /** Records a crash and says whether the backend may be started again. */
  recordCrash(): boolean {
    const time = this.now();
    this.crashes = this.crashes.filter((crash) => time - crash < this.windowMs);
    this.crashes.push(time);
    return this.crashes.length < this.limit;
  }

  reset(): void {
    this.crashes = [];
  }
}
