import { describe, expect, it, vi } from "vitest";
import { CompatibilityQueue } from "./compatibility-queue";

const evidence = {
  contextRevision: "r",
  result: { status: "compatible" as const, diagnostics: [] },
};
const deferred = () => {
  let resolve!: (value: typeof evidence) => void;
  const promise = new Promise<typeof evidence>((done) => {
    resolve = done;
  });
  return { promise, release: () => resolve(evidence) };
};

describe("compatibility queue", () => {
  it("runs one worker, in stable priority order, without retaining a result cache", async () => {
    const queue = new CompatibilityQueue();
    const gate = deferred();
    const order: string[] = [];
    const first = queue.request("first", 0, async () => {
      order.push("first");
      return gate.promise;
    });
    await Promise.resolve();
    const low = queue.request("low", 0, async () => {
      order.push("low");
      return evidence;
    });
    const high = queue.request("high", 5, async () => {
      order.push("high");
      return evidence;
    });
    const equal = queue.request("equal", 5, async () => {
      order.push("equal");
      return evidence;
    });
    await Promise.resolve();
    expect(order).toEqual(["first"]);
    gate.release();
    await Promise.all([first, low, high, equal]);
    expect(order).toEqual(["first", "high", "equal", "low"]);
    const again = vi.fn(async () => evidence);
    await queue.request("first", 0, again);
    expect(again).toHaveBeenCalledOnce();
    queue.dispose();
  });
  it("detaches one shared consumer without aborting the remaining consumer", async () => {
    const queue = new CompatibilityQueue();
    const gate = deferred();
    const controller = new AbortController();
    let signal!: AbortSignal;
    const work = vi.fn((value: AbortSignal) => {
      signal = value;
      return gate.promise;
    });
    const first = queue.request("shared", 0, work, controller.signal);
    const second = queue.request("shared", 5, work);
    const rejected = expect(first).rejects.toMatchObject({
      name: "AbortError",
    });
    await Promise.resolve();
    controller.abort();
    await rejected;
    expect(signal.aborted).toBe(false);
    gate.release();
    expect(await second).toBe(evidence);
    expect(work).toHaveBeenCalledOnce();
    queue.dispose();
  });
  it("waits for actual worker termination before starting another generation", async () => {
    const queue = new CompatibilityQueue();
    const gate = deferred();
    let signal!: AbortSignal;
    const old = queue.request("same", 0, (value) => {
      signal = value;
      return gate.promise;
    });
    const rejected = expect(old).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();
    queue.invalidate("same");
    const replacement = vi.fn(async () => evidence);
    const next = queue.request("same", 10, replacement);
    await rejected;
    expect(signal.aborted).toBe(true);
    expect(replacement).not.toHaveBeenCalled();
    gate.release();
    await next;
    expect(replacement).toHaveBeenCalledOnce();
    queue.dispose();
  });
  it("never starts a cancelled pending request and aborts the last active subscriber", async () => {
    const queue = new CompatibilityQueue();
    const active = new AbortController();
    const pending = new AbortController();
    const gate = deferred();
    let signal!: AbortSignal;
    const first = queue.request(
      "active",
      0,
      (value) => {
        signal = value;
        return gate.promise;
      },
      active.signal,
    );
    const rejected = expect(first).rejects.toMatchObject({
      name: "AbortError",
    });
    await Promise.resolve();
    const work = vi.fn(async () => evidence);
    const second = queue.request("pending", 0, work, pending.signal);
    const cancelled = expect(second).rejects.toMatchObject({
      name: "AbortError",
    });
    pending.abort();
    active.abort();
    await Promise.all([cancelled, rejected]);
    expect(signal.aborted).toBe(true);
    gate.release();
    await queue.request("tail", 0, async () => evidence);
    expect(work).not.toHaveBeenCalled();
    queue.dispose();
  });
  it("continues after a worker fails and disposes pending consumers", async () => {
    const queue = new CompatibilityQueue();
    await expect(
      queue.request("failure", 0, async () => {
        throw new Error("failure");
      }),
    ).rejects.toThrow("failure");
    expect(await queue.request("next", 0, async () => evidence)).toBe(evidence);
    const work = vi.fn(async () => evidence);
    const pending = queue.request("pending", 0, work);
    const rejected = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    queue.dispose();
    await rejected;
    expect(work).not.toHaveBeenCalled();
    await expect(queue.request("closed", 0, work)).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
