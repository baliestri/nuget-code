import { expect, it, vi } from "vitest";
import { ResourceCache } from "./resource-cache";
it("keeps force generations separate from old in-flight results and expires completed facts", async () => {
  vi.useFakeTimers();
  const cache = new ResourceCache();
  let release!: (value: string) => void;
  try {
    const old = cache.read(
      "same",
      100,
      0,
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    await Promise.resolve();
    const generation = cache.refresh();
    expect(await cache.read("same", 100, generation, async () => "new")).toBe(
      "new",
    );
    release("old");
    expect(await old).toBe("old");
    const work = vi.fn(async () => "later");
    expect(await cache.read("same", 100, generation, work)).toBe("new");
    expect(work).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(await cache.read("same", 100, generation, work)).toBe("later");
  } finally {
    cache.dispose();
    vi.useRealTimers();
  }
});
