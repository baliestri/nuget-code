import type { OperationResult, RestoreState } from "@nuget-code/protocol";
import { describe, expect, it } from "vitest";
import { summarizeRestore } from "./restoreSummary";

function result(...states: RestoreState[]): OperationResult {
  return {
    engine: "embedded",
    fellBack: false,
    projects: states.map((restore, index) => ({
      project: `P${index}.csproj`,
      changedFiles: [],
      editErrors: [],
      restore,
      messages: []
    }))
  };
}

describe("summarizeRestore", () => {
  it("all succeeded", () => {
    expect(summarizeRestore(result("succeeded", "succeeded"))).toEqual({ kind: "succeeded", failed: 0, total: 2 });
  });

  it("warnings still count as succeeded", () => {
    expect(summarizeRestore(result("succeededWithWarnings")).kind).toBe("succeeded");
  });

  it("one failed project", () => {
    expect(summarizeRestore(result("succeeded", "failed", "succeeded"))).toEqual({
      kind: "failed",
      failed: 1,
      total: 3
    });
  });

  it("cancelled without failures", () => {
    expect(summarizeRestore(result("cancelled", "succeeded")).kind).toBe("cancelled");
  });

  it("failed wins over cancelled", () => {
    expect(summarizeRestore(result("failed", "cancelled"))).toEqual({ kind: "failed", failed: 1, total: 2 });
  });

  it("no projects", () => {
    expect(summarizeRestore(result())).toEqual({ kind: "succeeded", failed: 0, total: 0 });
  });
});
