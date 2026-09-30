import { expect, it, vi } from "vitest";
import { RequestBroker } from "./request-broker";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
it("limits active work to six and schedules queued requests FIFO", async () => {
  const broker = new RequestBroker(6);
  const hold = gate();
  const started: number[] = [];
  const tasks = Array.from({ length: 12 }, (_, i) =>
    broker.run(String(i), async () => {
      started.push(i);
      await hold.promise;
      return i;
    }),
  );
  await Promise.resolve();
  expect(broker.metrics().active).toBe(6);
  expect(started).toEqual([0, 1, 2, 3, 4, 5]);
  hold.release();
  expect(await Promise.all(tasks)).toEqual(
    Array.from({ length: 12 }, (_, i) => i),
  );
  expect(started).toEqual(Array.from({ length: 12 }, (_, i) => i));
  expect(broker.metrics()).toEqual({
    active: 0,
    peak: 6,
    started: 12,
    deduplicated: 0,
  });
});
it("shares in-flight work without coupling consumer cancellation or caching failures", async () => {
  const broker = new RequestBroker(1);
  const hold = gate();
  const abort = new AbortController();
  let signal!: AbortSignal;
  const work = vi.fn(async (value: AbortSignal) => {
    signal = value;
    await hold.promise;
    return 42;
  });
  const first = broker.run("shared", work, abort.signal);
  const second = broker.run("shared", work);
  const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
  await Promise.resolve();
  abort.abort();
  await rejected;
  expect(signal.aborted).toBe(false);
  hold.release();
  expect(await second).toBe(42);
  expect(work).toHaveBeenCalledOnce();
  expect(broker.metrics().deduplicated).toBe(1);
  await expect(
    broker.run("shared", async () => {
      throw new Error("failure");
    }),
  ).rejects.toThrow("failure");
  expect(await broker.run("shared", async () => "fresh")).toBe("fresh");
});
it("waits for active cancellation cleanup and never starts abandoned queued work", async () => {
  const broker = new RequestBroker(1);
  const hold = gate();
  const active = new AbortController();
  const pending = new AbortController();
  let signal!: AbortSignal;
  const first = broker.run(
    "active",
    async (value) => {
      signal = value;
      await hold.promise;
    },
    active.signal,
  );
  const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
  await Promise.resolve();
  const work = vi.fn(async () => "pending");
  const abandoned = broker.run("pending", work, pending.signal);
  const cancelled = expect(abandoned).rejects.toMatchObject({
    name: "AbortError",
  });
  pending.abort();
  active.abort();
  await Promise.all([rejected, cancelled]);
  expect(signal.aborted).toBe(true);
  expect(broker.metrics().active).toBe(1);
  const next = broker.run("active", async () => "new-generation");
  expect(work).not.toHaveBeenCalled();
  hold.release();
  expect(await next).toBe("new-generation");
  expect(broker.metrics().peak).toBe(1);
});
it("disposes all consumers and rejects further requests", async () => {
  const broker = new RequestBroker(1);
  const work = vi.fn(async () => 1);
  const first = broker.run("a", work);
  const second = broker.run("b", work);
  const outcomes = Promise.allSettled([first, second]);
  broker.dispose();
  expect((await outcomes).map((item) => item.status)).toEqual([
    "rejected",
    "rejected",
  ]);
  expect(work).not.toHaveBeenCalled();
  await expect(broker.run("c", work)).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(() => new RequestBroker(0)).toThrow();
});
