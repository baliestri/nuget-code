import { expect, it, vi } from "vitest";
import { CacheStore, type CacheStorage } from "./cache-store";
const entry = (key: string, value: unknown = "á".repeat(100), time = 100) => ({
  schema: 2 as const,
  key,
  value,
  revision: "r",
  savedAt: time,
  accessedAt: time,
  expiresAt: 200,
});
function backend() {
  const files = new Map<string, string>();
  const storage: CacheStorage = {
    read: async (key) => files.get(key),
    write: vi.fn(async (key, value) => {
      files.set(key, value);
    }),
    remove: async (key) => {
      files.delete(key);
    },
    list: async () => [...files.keys()],
  };
  return { files, storage };
}
it("accounts UTF-8 bytes, persists LRU access in batches and reloads within quota", async () => {
  const { files, storage } = backend();
  let now = 100;
  const store = new CacheStore(storage, 850, () => now);
  await store.put(entry("a"));
  now++;
  await store.put(entry("b"));
  vi.mocked(storage.write).mockClear();
  now++;
  await store.get("a", false);
  expect(storage.write).not.toHaveBeenCalled();
  await store.flush();
  now++;
  await store.put(entry("c", undefined, now));
  expect(await store.get("b", true)).toBeUndefined();
  expect(store.sizeBytes()).toBeLessThanOrEqual(850);
  expect(
    [...files.values()].reduce(
      (total, value) => total + Buffer.byteLength(value),
      0,
    ),
  ).toBeLessThanOrEqual(850);
  const reloaded = new CacheStore(storage, 850, () => 300);
  expect(await reloaded.get("a", false)).toBeUndefined();
  expect(await reloaded.get("a", true)).toMatchObject({
    stale: true,
    revision: "r",
  });
});
it("serializes writers and recovers after backend failure without losing bounded memory data", async () => {
  const { storage } = backend();
  const report = vi.fn();
  const store = new CacheStore(storage, 1024, () => 100, report);
  vi.mocked(storage.write).mockRejectedValueOnce(new Error("disk unavailable"));
  await store.put(entry("a"));
  expect(await store.get("a", false)).toBeDefined();
  expect(report).toHaveBeenCalled();
  await Promise.all([store.put(entry("b", "b")), store.put(entry("c", "c"))]);
  await store.flush();
  const restored = new CacheStore(storage, 1024, () => 100);
  expect(await restored.get("a", false)).toBeDefined();
  expect(await restored.get("b", false)).toBeDefined();
  expect(await restored.get("c", false)).toBeDefined();
});
it("discards managed corrupt/schema entries only, rejects oversized values and isolates workspaces", async () => {
  const a = backend();
  const b = backend();
  a.files.set(`${"a".repeat(64)}.json`, "broken");
  a.files.set(`${"b".repeat(64)}.json`, JSON.stringify({ schema: 1 }));
  a.files.set("user-notes.txt", "keep");
  const store = new CacheStore(a.storage, 512, () => 100);
  await store.put(entry("large", "á".repeat(1000)));
  expect(await store.get("large", true)).toBeUndefined();
  await store.flush();
  expect([...a.files.keys()]).toEqual(["user-notes.txt"]);
  await store.put(entry("a", "value"));
  expect(
    await new CacheStore(b.storage, 512, () => 100).get("a", true),
  ).toBeUndefined();
  await store.invalidate("a");
  expect(await store.get("a", true)).toBeUndefined();
});

it("does not grow disk usage when eviction fails and retries cleanup on flush", async () => {
  const { storage, files } = backend();
  const store = new CacheStore(storage, 500, () => 100);
  await store.put(entry("old"));
  const remove = vi
    .spyOn(storage, "remove")
    .mockRejectedValueOnce(new Error("busy"));
  await store.put(entry("new", "é".repeat(100), 101));
  expect(await store.get("new", true)).toBeDefined();
  expect(
    [...files.values()].reduce((sum, text) => sum + Buffer.byteLength(text), 0),
  ).toBeLessThanOrEqual(500);
  remove.mockRestore();
  await store.flush();
  const reloaded = new CacheStore(storage, 500, () => 101);
  expect(await reloaded.get("old", true)).toBeUndefined();
  expect(await reloaded.get("new", true)).toBeDefined();
});

it("keeps data available when initial storage discovery fails and repairs persistence later", async () => {
  const { storage } = backend();
  const list = vi
    .spyOn(storage, "list")
    .mockRejectedValueOnce(new Error("offline"));
  const store = new CacheStore(storage, 1024, () => 100);
  await store.put(entry("a"));
  expect(await store.get("a", false)).toBeDefined();
  list.mockRestore();
  await store.flush();
  expect(
    await new CacheStore(storage, 1024, () => 100).get("a", false),
  ).toBeDefined();
});
