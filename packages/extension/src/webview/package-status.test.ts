import { expect, it } from "vitest";
import { createEmptyPackageManagerState } from "#manager";
import { packageStatus } from "./package-status";
it("puts source failure, stale data and counts in the native status without calling blocked candidates pending", () => {
  const state = createEmptyPackageManagerState();
  state.flows.catalog = {
    status: "failed",
    stale: true,
    error: "One or more package sources could not be loaded.",
  };
  state.updates.evaluation.candidates = [
    {
      key: "a",
      packageId: "Demo",
      projectPath: "/a",
      referenceIds: [],
      version: "1.5.0",
      feedUrls: [],
      compatibility: {
        status: "unverified",
        reason: "incomplete-catalog",
        diagnostics: [],
      },
    },
  ];
  const result = packageStatus(state);
  expect(result.text).toContain("$(warning)");
  expect(result.text).toContain("1 unverified");
  expect(result.text).not.toContain("checking");
  expect(result.tooltip).toContain("Showing previous data");
  expect(result.tooltip).toContain("Click to retry");
});
