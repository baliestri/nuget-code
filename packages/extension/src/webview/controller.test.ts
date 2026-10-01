import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import {
  createEmptyPackageManagerState,
  applyUpdateProjection,
} from "#manager";
import type { CompatibilityRequest } from "#client";
import type { InventorySnapshot } from "#contracts";
import {
  PackageDataService,
  type CandidateVerification,
} from "./package-data-service";
import { PackageCommandService } from "./package-commands";
it("#13: a late preview proof and a failed feed cannot authorize a preview upgrade after toggling it off", async () => {
  let state = {
    ...createEmptyPackageManagerState(),
    selectedTargetId: "a",
    includePrerelease: true,
  };
  state.targets = [
    { id: "a", name: "A", kind: "project", path: "/a", projectPaths: ["/a"] },
  ];
  state.installedPackages = [
    {
      id: "demo",
      name: "Demo",
      installedVersion: "1.0.0",
      availableVersion: "2.0.0-beta",
      projectPaths: ["/a"],
      versions: [],
      dependencyGroups: [],
    },
  ];
  const context = {
    targetId: "a",
    projectPaths: ["/a"],
    feedUrls: ["a", "b"],
    includePrerelease: true,
    revision: "sources",
  };
  const snapshot: InventorySnapshot = {
    targetId: "a",
    projectPaths: ["/a"],
    revision: "inputs",
    projectRevisions: { "/a": "project" },
    inputPaths: [],
    references: [
      {
        referenceId: "r",
        projectPath: "/a",
        packageId: "Demo",
        framework: "net8.0",
        direct: true,
        requestedVersion: "1.0.0",
        resolvedVersion: "1.0.0",
        declarationPath: "/a",
        affectedProjectPaths: ["/a"],
      },
    ],
  };
  let release!: (value: CandidateVerification) => void;
  let late!: CandidateVerification;
  const catalogs = vi.fn(async () => [
    {
      packageId: "Demo",
      revision: "catalog",
      complete: true,
      versions: [
        { version: "1.5.0", feedUrls: ["a"], listed: true },
        { version: "2.0.0-beta", feedUrls: ["b"], listed: true },
      ],
    },
  ]);
  const service = new PackageDataService(
    {
      loadInventory: async () => snapshot,
      loadCatalogs: catalogs,
      verify: async (candidate, _snapshot, selection) => {
        const plan = { contextRevision: "project", files: [], changes: [] };
        const planRevision = createHash("sha256")
          .update(JSON.stringify(plan))
          .digest("hex");
        late = {
          kind: "verified",
          request: {
            project: {
              contextRevision: "project",
            } as CompatibilityRequest["project"],
            candidate,
            plan,
            planRevision,
            selectedProjectPaths: selection.projectPaths,
            feedUrls: selection.feedUrls,
          },
          evidence: {
            contextRevision: "project",
            candidateKey: candidate.key,
            planRevision,
            result: { status: "compatible", diagnostics: [] },
          },
        };
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    },
    (projection) => {
      state = applyUpdateProjection(state, projection);
    },
  );
  const submit = vi.fn(async () => {});
  const commands = new PackageCommandService({ getState: () => state, submit });
  service.setContext(context);
  await service.refresh({ force: false });
  state = { ...state, includePrerelease: false };
  service.setContext({ ...context, includePrerelease: false });
  release(late);
  await Promise.resolve();
  await Promise.resolve();
  await commands.upgradePackages();
  expect(submit).not.toHaveBeenCalled();
  catalogs.mockRejectedValueOnce(new Error("offline"));
  await service.refresh({ force: true });
  await commands.upgradePackages();
  expect(
    state.updates.evaluation.candidates.every(
      (candidate) => !candidate.version.includes("-"),
    ),
  ).toBe(true);
  expect(state.hasUpgrades).toBe(false);
  expect(submit).not.toHaveBeenCalled();
  service.setContext({ ...context, includePrerelease: false, feedUrls: ["b"] });
  await commands.upgradePackages();
  expect(submit).not.toHaveBeenCalled();
  service.dispose();
});
