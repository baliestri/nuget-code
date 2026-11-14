import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findTarget, TARGETS } from "./targets";

describe("targets", () => {
  it("has the eight targets with their runtime identifiers", () => {
    expect(TARGETS.map((item) => [item.vsce, item.rid])).toEqual([
      ["win32-x64", "win-x64"],
      ["win32-arm64", "win-arm64"],
      ["linux-x64", "linux-x64"],
      ["linux-arm64", "linux-arm64"],
      ["alpine-x64", "linux-musl-x64"],
      ["alpine-arm64", "linux-musl-arm64"],
      ["darwin-x64", "osx-x64"],
      ["darwin-arm64", "osx-arm64"]
    ]);
  });

  it("only the Windows executables end in .exe", () => {
    for (const item of TARGETS) {
      expect(item.executable.endsWith(".exe")).toBe(item.vsce.startsWith("win32-"));
    }
  });

  it("the build matrix of the workflow covers exactly these targets", () => {
    const workflow = readFileSync(new URL("../.github/workflows/build-target.yml", import.meta.url), "utf8");
    const matrix = [...workflow.matchAll(/\{ target: ([\w-]+), rid: ([\w-]+),/g)].map((match) => [match[1], match[2]]);

    expect(matrix.toSorted()).toEqual(TARGETS.map((item) => [item.vsce, item.rid]).toSorted());
  });

  it("finds a target by its name and nothing for an unknown one", () => {
    expect(findTarget("alpine-arm64")?.rid).toBe("linux-musl-arm64");
    expect(findTarget("nope")).toBeUndefined();
  });
});
