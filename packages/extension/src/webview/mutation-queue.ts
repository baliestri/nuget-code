interface Item {
  id: string;
  start(): Promise<void>;
  reject(error: unknown): void;
  detach(): void;
}
/** Cancelling an active item does not release its slot: execution and reconciliation must settle. */
export class MutationQueue {
  private readonly pending: Item[] = [];
  private readonly ids = new Set<string>();
  private active = false;
  private disposed = false;
  enqueue<T>(
    id: string,
    work: () => Promise<T>,
    pendingSignal?: AbortSignal,
  ): Promise<T> {
    if (this.disposed || pendingSignal?.aborted)
      return Promise.reject(
        new DOMException("Operation cancelled.", "AbortError"),
      );
    if (this.ids.has(id))
      return Promise.reject(new Error("Duplicate operation ID."));
    this.ids.add(id);
    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        const index = this.pending.indexOf(item);
        if (index < 0) return;
        this.pending.splice(index, 1);
        this.ids.delete(id);
        item.detach();
        reject(new DOMException("Operation cancelled.", "AbortError"));
      };
      const item: Item = {
        id,
        reject,
        detach: () => pendingSignal?.removeEventListener("abort", abort),
        start: async () => {
          try {
            resolve(await work());
          } catch (error) {
            reject(error);
          }
        },
      };
      this.pending.push(item);
      pendingSignal?.addEventListener("abort", abort, { once: true });
      queueMicrotask(() => {
        void this.drain();
      });
    });
  }
  dispose(): void {
    this.disposed = true;
    for (const item of this.pending.splice(0)) {
      item.detach();
      this.ids.delete(item.id);
      item.reject(new DOMException("Operation cancelled.", "AbortError"));
    }
  }
  private async drain(): Promise<void> {
    if (this.active || this.disposed) return;
    const item = this.pending.shift();
    if (!item) return;
    this.active = true;
    item.detach();
    try {
      await item.start();
    } finally {
      this.active = false;
      this.ids.delete(item.id);
      void this.drain();
    }
  }
}
