export interface RequestMetrics {
  started: number;
  deduplicated: number;
  active: number;
  peak: number;
}
interface Consumer {
  resolve(value: unknown): void;
  reject(reason: unknown): void;
  detach(): void;
}
interface Request {
  key: string;
  work(signal: AbortSignal): Promise<unknown>;
  controller: AbortController;
  consumers: Set<Consumer>;
  started: boolean;
}
const aborted = () =>
  new DOMException("The request was aborted.", "AbortError");

/** A key must identify a single resource/representation and authentication context. */
export class RequestBroker {
  private readonly requests = new Map<string, Request>();
  private readonly counts: RequestMetrics = {
    started: 0,
    deduplicated: 0,
    active: 0,
    peak: 0,
  };
  private scheduled = false;
  private disposed = false;
  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1)
      throw new RangeError("Request limit must be a positive integer.");
  }
  metrics(): Readonly<RequestMetrics> {
    return Object.freeze({ ...this.counts });
  }
  run<T>(
    key: string,
    work: (signal: AbortSignal) => Promise<T>,
    consumerSignal?: AbortSignal,
  ): Promise<T> {
    if (this.disposed || consumerSignal?.aborted)
      return Promise.reject(aborted());
    let request = this.requests.get(key);
    if (request) this.counts.deduplicated++;
    else {
      request = {
        key,
        work,
        controller: new AbortController(),
        consumers: new Set(),
        started: false,
      };
      this.requests.set(key, request);
    }
    const job = request;
    const promise = new Promise<T>((resolve, reject) => {
      const abort = () => {
        consumer.detach();
        job.consumers.delete(consumer);
        reject(aborted());
        if (!job.consumers.size) this.cancel(job);
      };
      const consumer: Consumer = {
        resolve: (value) => resolve(value as T),
        reject,
        detach: () => consumerSignal?.removeEventListener("abort", abort),
      };
      job.consumers.add(consumer);
      consumerSignal?.addEventListener("abort", abort, { once: true });
    });
    this.schedule();
    return promise;
  }
  dispose(): void {
    this.disposed = true;
    for (const request of this.requests.values()) this.cancel(request);
  }
  private cancel(request: Request): void {
    if (this.requests.get(request.key) === request)
      this.requests.delete(request.key);
    request.controller.abort();
    for (const consumer of request.consumers) {
      consumer.detach();
      consumer.reject(aborted());
    }
    request.consumers.clear();
    this.schedule();
  }
  private schedule(): void {
    if (this.scheduled || this.disposed) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (this.disposed) return;
      for (const request of this.requests.values()) {
        if (this.counts.active >= this.limit) break;
        if (request.started) continue;
        request.started = true;
        this.counts.started++;
        this.counts.peak = Math.max(this.counts.peak, ++this.counts.active);
        void this.execute(request);
      }
    });
  }
  private async execute(request: Request): Promise<void> {
    try {
      const value = await request.work(request.controller.signal);
      for (const consumer of request.consumers) consumer.resolve(value);
    } catch (error) {
      for (const consumer of request.consumers) consumer.reject(error);
    } finally {
      for (const consumer of request.consumers) consumer.detach();
      request.consumers.clear();
      if (this.requests.get(request.key) === request)
        this.requests.delete(request.key);
      this.counts.active--;
      this.schedule();
    }
  }
}
