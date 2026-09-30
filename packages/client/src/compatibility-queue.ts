import type { CompatibilityEvidence } from "#contracts";

interface Consumer<T> {
  resolve(value: T): void;
  reject(reason: unknown): void;
  detach(): void;
}
interface Entry<T> {
  key: string;
  priority: number;
  sequence: number;
  work(signal: AbortSignal): Promise<T>;
  controller: AbortController;
  consumers: Set<Consumer<T>>;
}
const cancelled = () =>
  new DOMException("Compatibility request cancelled.", "AbortError");

/** One instance owns one process slot. Higher numbers run first; equal priorities are FIFO. */
export class CompatibilityQueue<
  T extends CompatibilityEvidence = CompatibilityEvidence,
> {
  private readonly entries = new Map<string, Entry<T>>();
  private active: Entry<T> | undefined;
  private sequence = 0;
  private scheduled = false;
  private disposed = false;

  request(
    key: string,
    priority: number,
    work: Entry<T>["work"],
    consumerSignal?: AbortSignal,
  ): Promise<T> {
    if (this.disposed || consumerSignal?.aborted)
      return Promise.reject(cancelled());
    if (!Number.isFinite(priority))
      return Promise.reject(new RangeError("Priority must be finite."));
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        key,
        priority,
        work,
        sequence: this.sequence++,
        controller: new AbortController(),
        consumers: new Set(),
      };
      this.entries.set(key, entry);
    } else entry.priority = Math.max(entry.priority, priority);
    const job = entry;
    const promise = new Promise<T>((resolve, reject) => {
      const abort = () => {
        consumer.detach();
        job.consumers.delete(consumer);
        reject(cancelled());
        if (!job.consumers.size) this.cancel(job);
      };
      const consumer: Consumer<T> = {
        resolve,
        reject,
        detach: () => consumerSignal?.removeEventListener("abort", abort),
      };
      job.consumers.add(consumer);
      consumerSignal?.addEventListener("abort", abort, { once: true });
    });
    this.schedule();
    return promise;
  }

  invalidate(key: string): void {
    const entry = this.entries.get(key);
    if (entry) this.cancel(entry);
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.entries.values()) this.cancel(entry);
  }

  private cancel(entry: Entry<T>): void {
    if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
    entry.controller.abort();
    for (const consumer of entry.consumers) {
      consumer.detach();
      consumer.reject(cancelled());
    }
    entry.consumers.clear();
    // The slot stays occupied until the worker acknowledges termination and cleanup.
    this.schedule();
  }

  private schedule(): void {
    if (this.scheduled || this.disposed || this.active) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (this.active || this.disposed) return;
      const next = [...this.entries.values()].sort(
        (a, b) => b.priority - a.priority || a.sequence - b.sequence,
      )[0];
      if (!next) return;
      this.active = next;
      void this.run(next);
    });
  }

  private async run(entry: Entry<T>): Promise<void> {
    try {
      const result = await entry.work(entry.controller.signal);
      for (const consumer of entry.consumers) consumer.resolve(result);
    } catch (error) {
      for (const consumer of entry.consumers) consumer.reject(error);
    } finally {
      for (const consumer of entry.consumers) consumer.detach();
      entry.consumers.clear();
      if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
      this.active = undefined;
      this.schedule();
    }
  }
}
