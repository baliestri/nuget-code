import { expect, it, vi } from "vitest";
import { MutationQueue } from "./mutation-queue";
it("serializes the complete operation and cancels only pending work", async () => {
  const queue = new MutationQueue();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const active = new AbortController();
  const pending = new AbortController();
  const a = queue.enqueue("a", () => gate, active.signal);
  await Promise.resolve();
  const work = vi.fn(async () => 2);
  const b = queue.enqueue("b", work, pending.signal);
  const rejected = expect(b).rejects.toMatchObject({ name: "AbortError" });
  pending.abort();
  active.abort();
  await rejected;
  const next = vi.fn(async () => 3);
  const c = queue.enqueue("c", next);
  expect(next).not.toHaveBeenCalled();
  release();
  await a;
  expect(await c).toBe(3);
  expect(work).not.toHaveBeenCalled();
  queue.dispose();
});
