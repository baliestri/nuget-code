import { expect, it, vi } from "vitest";
import { createEmptyPackageManagerState } from "#manager";
import { PackageCommandService } from "./package-commands";
it("captures destination/version before enqueueing and never uses availableVersion as authority", async () => {
  const state = createEmptyPackageManagerState();
  state.targets = [
    {
      id: "a",
      kind: "project",
      path: "/a.csproj",
      name: "A",
      projectPaths: ["/a.csproj"],
    },
  ];
  state.selectedTargetId = "a";
  state.installedPackages = [
    {
      id: "demo",
      name: "Demo",
      availableVersion: "2.0.0-beta",
      projectPaths: ["/a.csproj"],
      versions: [],
      dependencyGroups: [],
    },
  ];
  state.selectedPackageId = "demo";
  const submit = vi.fn(async (plan: import("#contracts").MutationPlan) => {
    expect(plan.targetId).toBe("a");
  });
  const service = new PackageCommandService({ getState: () => state, submit });
  await service.upgradePackages();
  expect(submit).not.toHaveBeenCalled();
  await expect(
    service.addOrUpgradeSelectedPackage("upgradeSelectedPackage", {}),
  ).rejects.toThrow("concrete");
  await service.addOrUpgradeSelectedPackage("upgradeSelectedPackage", {
    version: "1.5.0",
    projectPaths: ["/a.csproj"],
  });
  expect(submit).toHaveBeenCalledWith(
    expect.objectContaining({
      targetId: "a",
      steps: [
        expect.objectContaining({
          version: "1.5.0",
          projectPaths: ["/a.csproj"],
        }),
      ],
    }),
    expect.anything(),
    expect.anything(),
    false,
  );
  state.selectedTargetId = "other";
  expect(submit.mock.calls[0]?.[0]).toMatchObject({ targetId: "a" });
});

it("submits the exact verified subset and rejects stale, duplicate or ineligible selections", async () => {
  const state = createEmptyPackageManagerState();
  state.selectedTargetId = "target";
  state.targets = [
    {
      id: "target",
      name: "Target",
      kind: "project",
      path: "/a",
      projectPaths: ["/a"],
    },
  ];
  state.updates.context = {
    targetId: "target",
    projectPaths: ["/a"],
    feedUrls: ["feed"],
    includePrerelease: false,
    revision: "current",
  };
  state.updates.evaluation.candidates = ["a", "b", "c"].map((key) => ({
    key,
    packageId: key,
    projectPath: "/a",
    referenceIds: [key],
    version: "2.0.0",
    feedUrls: ["feed"],
    compatibility:
      key === "c"
        ? { status: "unverified", reason: "pending", diagnostics: [] }
        : { status: "compatible", diagnostics: [] },
  }));
  const submit = vi.fn(async () => {});
  const service = new PackageCommandService({ getState: () => state, submit });
  for (const [keys, revision] of [
    [["a"], "old"],
    [["missing"], "current"],
    [["c"], "current"],
    [["a", "a"], "current"],
  ] as [string[], string][])
    await expect(service.upgradeCandidates(keys, revision)).rejects.toThrow();
  expect(submit).not.toHaveBeenCalled();
  await service.upgradeCandidates(["b"], "current");
  expect(submit).toHaveBeenCalledWith(
    expect.objectContaining({
      steps: [
        expect.objectContaining({ id: "b", packageId: "b", version: "2.0.0" }),
      ],
    }),
    expect.anything(),
    expect.anything(),
    true,
  );
  state.selectedTargetId = "other";
  await expect(service.upgradeCandidates(["a"], "current")).rejects.toThrow(
    "stale",
  );
});
