import { createHash } from "node:crypto";
import {
  cacheHit,
  serializeCacheEntry,
  validCacheEntry,
  type CacheEntry,
  type CacheHit,
} from "#client/cache";

export interface CacheStorage {
  read(key: string): Promise<string | undefined>;
  write(key: string, payload: string): Promise<void>;
  remove(key: string): Promise<void>;
  list(): Promise<readonly string[]>;
}
export const cacheFilePattern = /^[a-f0-9]{64}\.json$/;
const identity = (key: string) =>
  createHash("sha256").update(key).digest("hex");
const bytes = (entry: CacheEntry<unknown>) =>
  Buffer.byteLength(JSON.stringify(entry), "utf8");

/** Serialized writers, bounded memory fallback, and independently recoverable disk entries. */
export class CacheStore {
  private readonly entries = new Map<string, CacheEntry<unknown>>();
  private readonly sizes = new Map<string, number>();
  private memoryBytes = 0;
  private readonly persisted = new Map<string, number>();
  private readonly writes = new Set<string>();
  private readonly touches = new Set<string>();
  private readonly removals = new Set<string>();
  private loaded = false;
  private reported = false;
  private chain: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly storage: CacheStorage,
    private readonly budgetBytes: number,
    private readonly now: () => number,
    private readonly report: (error: unknown) => void = () => {},
  ) {
    if (!Number.isFinite(budgetBytes) || budgetBytes < 0)
      throw new RangeError("Invalid cache budget.");
  }
  sizeBytes(): number {
    return this.memoryBytes;
  }
  private install(entry: CacheEntry<unknown>): void {
    const size = bytes(entry);
    this.memoryBytes += size - (this.sizes.get(entry.key) ?? 0);
    this.sizes.set(entry.key, size);
    this.entries.set(entry.key, entry);
  }
  private touch(entry: CacheEntry<unknown>): void {
    const now = this.now();
    const delta =
      JSON.stringify(now).length - JSON.stringify(entry.accessedAt).length;
    entry.accessedAt = now;
    this.memoryBytes += delta;
    this.sizes.set(entry.key, this.sizes.get(entry.key)! + delta);
    this.touches.add(entry.key);
  }
  private warn(error: unknown): void {
    if (!this.reported) {
      this.reported = true;
      this.report(error);
    }
  }
  get<T>(key: string, allowStale: boolean): Promise<CacheHit<T> | undefined> {
    return this.enqueue(async () => {
      const id = identity(key);
      const entry = this.entries.get(id);
      if (!entry) return undefined;
      const hit = cacheHit<T>(entry, this.now());
      if (hit.stale && !allowStale) return undefined;
      this.touch(entry);
      this.trim();
      return hit;
    });
  }
  put<T>(entry: CacheEntry<T>): Promise<void> {
    // Capture the caller's value before queueing, without retaining mutable references.
    const snapshot = JSON.parse(serializeCacheEntry(entry)) as CacheEntry<T>;
    snapshot.key = identity(snapshot.key);
    return this.enqueue(async () => {
      if (bytes(snapshot) > this.budgetBytes) this.evict(snapshot.key);
      else {
        const previous = this.entries.get(snapshot.key);
        if (
          previous &&
          previous.revision === snapshot.revision &&
          previous.expiresAt === snapshot.expiresAt &&
          JSON.stringify(previous.value) === JSON.stringify(snapshot.value)
        ) {
          this.touch(previous);
        } else {
          this.install(snapshot);
          this.writes.add(snapshot.key);
          this.removals.delete(snapshot.key);
        }
        this.trim();
      }
      await this.persist();
    });
  }
  invalidate(key: string): Promise<void> {
    return this.enqueue(async () => {
      this.evict(identity(key));
      await this.persist();
    });
  }
  flush(): Promise<void> {
    return this.enqueue(async () => {
      for (const id of this.touches)
        if (this.entries.has(id)) this.writes.add(id);
      this.touches.clear();
      await this.persist();
    });
  }
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.chain.then(async () => {
      await this.load();
      return work();
    });
    this.chain = pending.catch(() => {});
    return pending;
  }
  private async load(): Promise<void> {
    if (this.loaded) return;
    try {
      for (const file of await this.storage.list()) {
        if (!cacheFilePattern.test(file)) continue;
        const id = file.slice(0, -5);
        const text = await this.storage.read(file);
        if (text === undefined) continue;
        this.persisted.set(id, Buffer.byteLength(text, "utf8"));
        let entry: unknown;
        try {
          entry = JSON.parse(text);
        } catch {
          /* Managed corruption is discarded below. */
        }
        if (
          !validCacheEntry(entry) ||
          entry.key !== id ||
          Buffer.byteLength(text, "utf8") > this.budgetBytes ||
          JSON.stringify(entry) !== text
        ) {
          this.removals.add(id);
          this.warn(new Error("Discarded an invalid managed cache entry."));
          continue;
        }
        if (
          !this.entries.has(id) &&
          !this.writes.has(id) &&
          !this.removals.has(id)
        )
          this.install(entry);
        this.trim();
      }
      this.loaded = true;
      await this.persist();
    } catch (error) {
      this.warn(error);
    }
  }
  private evict(id: string): void {
    this.memoryBytes -= this.sizes.get(id) ?? 0;
    this.sizes.delete(id);
    this.entries.delete(id);
    this.writes.delete(id);
    this.touches.delete(id);
    this.removals.add(id);
  }
  private trim(): void {
    if (this.memoryBytes <= this.budgetBytes) return;
    const ordered = [...this.entries.values()].sort(
      (a, b) => a.accessedAt - b.accessedAt || (a.key < b.key ? -1 : 1),
    );
    for (const entry of ordered) {
      if (this.memoryBytes <= this.budgetBytes) break;
      this.evict(entry.key);
    }
  }
  private async persist(): Promise<void> {
    if (!this.loaded) return; // Unknown disk usage must not be augmented after a failed scan.
    for (const id of [...this.removals]) {
      try {
        await this.storage.remove(`${id}.json`);
        this.persisted.delete(id);
        this.removals.delete(id);
      } catch (error) {
        this.warn(error);
      }
    }
    for (const id of [...this.writes]) {
      const entry = this.entries.get(id);
      if (!entry) {
        this.writes.delete(id);
        continue;
      }
      const text = serializeCacheEntry(entry);
      const size = Buffer.byteLength(text, "utf8");
      const disk = [...this.persisted.values()].reduce(
        (sum, value) => sum + value,
        0,
      );
      if (disk - (this.persisted.get(id) ?? 0) + size > this.budgetBytes)
        continue;
      try {
        await this.storage.write(`${id}.json`, text);
        this.persisted.set(id, size);
        this.writes.delete(id);
      } catch (error) {
        this.warn(error);
      }
    }
  }
}

/** Volatile backend for windows without workspace storage; CacheStore still enforces its quota. */
export function memoryCacheStorage(): CacheStorage {
  const entries = new Map<string, string>();
  return {
    read: async (key) => entries.get(key),
    write: async (key, value) => {
      entries.set(key, value);
    },
    remove: async (key) => {
      entries.delete(key);
    },
    list: async () => [...entries.keys()],
  };
}
