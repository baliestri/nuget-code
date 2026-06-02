// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import {
  readBoolean,
  readString,
  readStringList,
  writeBoolean,
  writeString,
  writeStringList,
} from "./useLocalStorage.js";

describe("local storage helpers", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("reads and writes booleans", () => {
    expect(readBoolean("missing", true)).toBe(true);
    writeBoolean("flag", false);
    expect(readBoolean("flag", true)).toBe(false);
    writeBoolean("flag", true);
    expect(readBoolean("flag", false)).toBe(true);
  });

  it("reads and writes allowed strings", () => {
    expect(readString("missing", "a", ["a", "b"])).toBe("a");
    writeString("mode", "b");
    expect(readString("mode", "a", ["a", "b"])).toBe("b");
    window.localStorage.setItem("bad", "x");
    expect(readString("bad", "a", ["a", "b"])).toBe("a");
  });

  it("reads and writes filtered string lists", () => {
    expect(readStringList("missing", ["a"], ["a", "b"])).toEqual(["a"]);
    writeStringList("list", ["a", "b"]);
    expect(readStringList("list", ["a"], ["b", "c"])).toEqual(["b"]);
    window.localStorage.setItem("bad", "{");
    expect(readStringList("bad", ["a"], ["a"])).toEqual(["a"]);
    window.localStorage.setItem("object", "{}");
    expect(readStringList("object", ["a"], ["a"])).toEqual(["a"]);
    window.localStorage.setItem("none", JSON.stringify(["x"]));
    expect(readStringList("none", ["a"], ["a"])).toEqual(["a"]);
  });
});
