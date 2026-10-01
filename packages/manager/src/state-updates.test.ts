import { expect, it } from "vitest";
import { createEmptyPackageManagerState } from "./state";
import {
  applyUpdateProjection,
  presentPackageDetails,
  referenceInventory,
} from "./state-updates";
it("derives hasUpgrades only from executable projected candidates", () => {
  const state = createEmptyPackageManagerState();
  const candidate = {
    key: "key",
    packageId: "Demo",
    projectPath: "/a",
    referenceIds: ["r"],
    version: "2.0.0",
    feedUrls: ["feed"],
    compatibility: {
      status: "unverified" as const,
      reason: "pending",
      diagnostics: [],
    },
  };
  const updates = {
    ...state.updates,
    evaluation: { candidates: [candidate], blocked: [] },
  };
  expect(applyUpdateProjection(state, updates).hasUpgrades).toBe(false);
  expect(
    applyUpdateProjection(state, {
      ...updates,
      evaluation: {
        candidates: [
          {
            ...candidate,
            compatibility: { status: "compatible", diagnostics: [] },
          },
        ],
        blocked: [],
      },
    }).hasUpgrades,
  ).toBe(true);
});
it("does not invent an installed version from a requested range", () => {
  const inventory = referenceInventory({
    targetId: "a",
    revision: "r",
    projectPaths: ["/a"],
    projectRevisions: {},
    inputPaths: [],
    references: [
      {
        referenceId: "ref",
        projectPath: "/a",
        framework: "net8.0",
        packageId: "Demo",
        requestedVersion: "[1,2)",
        resolvedVersion: null,
        declarationPath: null,
        affectedProjectPaths: [],
        direct: true,
      },
    ],
  });
  expect(inventory.installed[0]?.installedVersion).toBeUndefined();
  expect(inventory.installed[0]?.availableVersion).toBeUndefined();
});
it("presents selected-feed metadata without rewriting installed facts or the candidate", () => {
  const base = {
    id: "a",
    name: "Demo",
    installedVersion: "1.0.0",
    availableVersion: "2.0.0",
    projectPaths: ["/a"],
    versions: [],
    dependencyGroups: [],
  };
  expect(
    presentPackageDetails(base, {
      ...base,
      installedVersion: "9.0.0",
      availableVersion: "10.0.0",
      projectPaths: ["/other"],
      description: "metadata",
    }),
  ).toMatchObject({
    installedVersion: "1.0.0",
    availableVersion: "2.0.0",
    projectPaths: ["/a"],
    description: "metadata",
  });
});
