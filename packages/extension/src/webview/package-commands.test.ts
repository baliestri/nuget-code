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
