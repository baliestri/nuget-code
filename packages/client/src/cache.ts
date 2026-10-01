export interface CacheEntry<T> {
  schema: 2;
  key: string;
  value: T;
  revision: string;
  savedAt: number;
  expiresAt: number | null;
  accessedAt: number;
}
export interface CacheHit<T> {
  value: T;
  revision: string;
  stale: boolean;
  savedAt: number;
  expiresAt: number | null;
}
export const cachePolicy = {
  searchTtlMs: 120_000,
  metadataTtlMs: 900_000,
  searchKeys: 100,
  workspaceBytes: 25 * 1024 * 1024,
} as const;
export function validCacheEntry(value: unknown): value is CacheEntry<unknown> {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<CacheEntry<unknown>>;
  return (
    entry.schema === 2 &&
    typeof entry.key === "string" &&
    entry.key.length > 0 &&
    "value" in entry &&
    entry.value !== undefined &&
    typeof entry.revision === "string" &&
    typeof entry.savedAt === "number" &&
    Number.isFinite(entry.savedAt) &&
    typeof entry.accessedAt === "number" &&
    Number.isFinite(entry.accessedAt) &&
    (entry.expiresAt === null ||
      (typeof entry.expiresAt === "number" && Number.isFinite(entry.expiresAt)))
  );
}
export function serializeCacheEntry(entry: CacheEntry<unknown>): string {
  const serialized = JSON.stringify(entry);
  if (!validCacheEntry(JSON.parse(serialized)))
    throw new TypeError("Invalid cache entry.");
  return serialized;
}
export function cacheHit<T>(
  entry: CacheEntry<unknown>,
  now: number,
): CacheHit<T> {
  return {
    value: JSON.parse(JSON.stringify(entry.value)) as T,
    revision: entry.revision,
    stale: entry.expiresAt !== null && entry.expiresAt <= now,
    savedAt: entry.savedAt,
    expiresAt: entry.expiresAt,
  };
}
export class MemoryCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>();
  private readonly sizes = new Map<string, number>();
  private size = 0;
  constructor(
    private readonly maxEntries: number,
    private readonly now: () => number,
    private readonly maxBytes = Infinity,
  ) {
    if (
      !Number.isInteger(maxEntries) ||
      maxEntries < 1 ||
      maxBytes < 0 ||
      (!Number.isFinite(maxBytes) && maxBytes !== Infinity)
    )
      throw new RangeError("Invalid cache limits.");
  }
  get<T>(key: string, allowStale: boolean): CacheHit<T> | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    const hit = cacheHit<T>(entry, this.now());
    if (hit.stale && !allowStale) return undefined;
    const now = this.now();
    const delta =
      JSON.stringify(now).length - JSON.stringify(entry.accessedAt).length;
    entry.accessedAt = now;
    this.size += delta;
    this.sizes.set(key, this.sizes.get(key)! + delta);
    this.trim();
    return hit;
  }
  put<T>(entry: CacheEntry<T>): void {
    const serialized = serializeCacheEntry(entry);
    this.delete(entry.key);
    const size = Buffer.byteLength(serialized, "utf8");
    if (size > this.maxBytes) return;
    this.entries.set(entry.key, JSON.parse(serialized) as CacheEntry<T>);
    this.sizes.set(entry.key, size);
    this.size += size;
    this.trim();
  }
  delete(key: string): void {
    this.size -= this.sizes.get(key) ?? 0;
    this.sizes.delete(key);
    this.entries.delete(key);
  }
  clear(): void {
    this.entries.clear();
    this.sizes.clear();
    this.size = 0;
  }
  snapshot(): CacheEntry<unknown>[] {
    return [...this.entries.values()].map(
      (entry) => JSON.parse(JSON.stringify(entry)) as CacheEntry<unknown>,
    );
  }
  private trim(): void {
    if (this.entries.size <= this.maxEntries && this.size <= this.maxBytes)
      return;
    const ordered = [...this.entries.values()].sort(
      (a, b) => a.accessedAt - b.accessedAt || (a.key < b.key ? -1 : 1),
    );
    while (this.entries.size > this.maxEntries || this.size > this.maxBytes) {
      const oldest = ordered.shift();
      if (!oldest) break;
      this.delete(oldest.key);
    }
  }
}
