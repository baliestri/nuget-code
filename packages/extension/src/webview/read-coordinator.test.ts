import { expect, it } from "vitest";
import { ReadCoordinator } from "./read-coordinator";

it("keeps inventory alive when search changes, but cancels replaced details", () => {
  const reads = new ReadCoordinator();
  const inventory = reads.begin("inventory", "target-a:inputs-1");
  reads.begin("search", "target-a:demo");
  reads.begin("search", "target-a:newtonsoft");
  expect(inventory.signal.aborted).toBe(false);
  expect(reads.isCurrent(inventory)).toBe(true);
  const previous = reads.begin("details", "target-a:demo");
  const current = reads.begin("details", "target-b:demo");
  expect(previous.signal.aborted).toBe(true);
  expect(reads.isCurrent(previous)).toBe(false);
  expect(reads.isCurrent(current)).toBe(true);
  expect(reads.isCurrent({ ...current, contextKey: "forged" })).toBe(false);
  reads.dispose();
});
it("does not let a late response or its finally take ownership from the successor", async () => {
  const reads = new ReadCoordinator();
  const published: string[] = [];
  const finished: number[] = [];
  let resolve!: () => void;
  const gate = new Promise<void>((done) => {
    resolve = done;
  });
  const old = reads.begin("inventory", "old-target");
  const work = (async () => {
    try {
      await gate;
      if (reads.isCurrent(old)) published.push("old");
    } finally {
      if (reads.isCurrent(old)) finished.push(old.sequence);
    }
  })();
  const current = reads.begin("inventory", "new-target");
  resolve();
  await work;
  expect(published).toEqual([]);
  expect(finished).toEqual([]);
  expect(reads.isCurrent(current)).toBe(true);
  reads.dispose();
});
it("invalidates cancelled tickets, preserves increasing sequences, and disposes all flows", () => {
  const reads = new ReadCoordinator();
  const first = reads.begin("catalog", "a");
  reads.cancel("catalog");
  const second = reads.begin("catalog", "a");
  expect(second.sequence).toBeGreaterThan(first.sequence);
  expect(reads.isCurrent(first)).toBe(false);
  const search = reads.begin("search", "q");
  reads.dispose();
  reads.dispose();
  expect(second.signal.aborted).toBe(true);
  expect(search.signal.aborted).toBe(true);
  expect(() => reads.begin("inventory", "a")).toThrow();
});
