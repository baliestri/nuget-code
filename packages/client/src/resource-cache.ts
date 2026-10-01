import { MemoryCache, cachePolicy } from "#client/cache";
import { RequestBroker } from "#client/request-broker";
export class ResourceCache {
  private readonly cache: MemoryCache;
  constructor(maxEntries = 2000) {
    this.cache = new MemoryCache(
      maxEntries,
      Date.now,
      cachePolicy.workspaceBytes,
    );
  }
  private readonly pending = new RequestBroker(Number.MAX_SAFE_INTEGER);
  private epoch = 0;
  private hits = 0;
  private misses = 0;
  get generation(): number {
    return this.epoch;
  }
  refresh(): number {
    this.epoch++;
    this.cache.clear();
    return this.epoch;
  }
  metrics(): { hits: number; misses: number; deduplicated: number } {
    return {
      hits: this.hits,
      misses: this.misses,
      deduplicated: this.pending.metrics().deduplicated,
    };
  }
  async read<T>(
    key: string,
    ttl: number,
    generation: number,
    work: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
    cacheable: (value: T) => boolean = () => true,
  ): Promise<T> {
    signal?.throwIfAborted();
    const identity = `${generation}:${key}`;
    const cached =
      generation === this.epoch
        ? this.cache.get<T>(identity, false)
        : undefined;
    if (cached) {
      this.hits++;
      return cached.value;
    }
    this.misses++;
    return this.pending.run(
      identity,
      async (sharedSignal) => {
        const value = await work(sharedSignal);
        sharedSignal.throwIfAborted();
        if (
          generation === this.epoch &&
          value !== undefined &&
          cacheable(value)
        ) {
          const now = Date.now();
          this.cache.put({
            schema: 2,
            key: identity,
            value,
            revision: String(generation),
            savedAt: now,
            accessedAt: now,
            expiresAt: now + ttl,
          });
        }
        return value;
      },
      signal,
    );
  }
  dispose(): void {
    this.pending.dispose();
    this.cache.clear();
  }
}
