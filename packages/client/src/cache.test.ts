import { expect, it } from "vitest";
import { MemoryCache } from "./cache";
it("expires by wall clock, supports stale reads and evicts deterministically by LRU", () => {
  let now = 100;
  const cache = new MemoryCache(2, () => now);
  const put = (key: string) =>
    cache.put({
      schema: 2,
      key,
      value: { key },
      revision: "r",
      savedAt: now,
      accessedAt: now,
      expiresAt: 200,
    });
  put("a");
  now++;
  put("b");
  now++;
  cache.get("a", false);
  now++;
  put("c");
  expect(cache.get("b", true)).toBeUndefined();
  now = 200;
  expect(cache.get("a", false)).toBeUndefined();
  expect(cache.get("a", true)).toMatchObject({ stale: true, revision: "r" });
  const hit = cache.get<{ key: string }>("a", true)!;
  hit.value.key = "changed";
  expect(cache.get<{ key: string }>("a", true)?.value.key).toBe("a");
  cache.clear();
  expect(cache.get("a", true)).toBeUndefined();
});
it("bounds payload bytes as well as key count and rejects malformed entries", () => {
  const cache = new MemoryCache(100, () => 1, 256);
  cache.put({
    schema: 2,
    key: "huge",
    value: "á".repeat(200),
    revision: "r",
    savedAt: 1,
    accessedAt: 1,
    expiresAt: null,
  });
  expect(cache.get("huge", true)).toBeUndefined();
  expect(() =>
    cache.put({
      schema: 2,
      key: "bad",
      value: undefined,
      revision: "r",
      savedAt: 1,
      accessedAt: 1,
      expiresAt: null,
    }),
  ).toThrow();
});
