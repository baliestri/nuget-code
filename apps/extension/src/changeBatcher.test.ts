import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChangeBatcher } from "./changeBatcher";

describe("ChangeBatcher", () => {
  let batches: string[][];
  let batcher: ChangeBatcher;

  beforeEach(() => {
    vi.useFakeTimers();
    batches = [];
    batcher = new ChangeBatcher(200, (paths) => batches.push(paths));
  });

  afterEach(() => {
    batcher.dispose();
    vi.useRealTimers();
  });

  it("changes inside the window are sent once", () => {
    batcher.add("a");
    vi.advanceTimersByTime(50);
    batcher.add("b");
    vi.advanceTimersByTime(50);
    batcher.add("c");
    vi.advanceTimersByTime(200);

    expect(batches).toEqual([["a", "b", "c"]]);
  });

  it("the same path is sent once", () => {
    batcher.add("a");
    batcher.add("a");
    vi.advanceTimersByTime(200);

    expect(batches).toEqual([["a"]]);
  });

  it("a later change starts a new batch", () => {
    batcher.add("a");
    vi.advanceTimersByTime(250);
    batcher.add("b");
    vi.advanceTimersByTime(250);

    expect(batches).toEqual([["a"], ["b"]]);
  });

  it("the window restarts with each change", () => {
    for (let index = 0; index < 4; index++) {
      batcher.add(`file-${index}`);
      vi.advanceTimersByTime(150);
    }

    expect(batches).toEqual([]);
    vi.advanceTimersByTime(50);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(4);
  });

  it("nothing is sent before the delay", () => {
    batcher.add("a");
    vi.advanceTimersByTime(199);

    expect(batches).toEqual([]);
  });

  it("dispose drops what is pending", () => {
    batcher.add("a");
    batcher.dispose();
    vi.advanceTimersByTime(300);

    expect(batches).toEqual([]);
  });
});
