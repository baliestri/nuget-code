import { expect, it, vi } from "vitest";
import { createEmptyPackageManagerState } from "#manager";
import { PackageCommandService } from "./package-commands";
it("does not turn legacy availableVersion metadata or an unbound verdict into automatic CLI execution", async () => {
  const state = createEmptyPackageManagerState();
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
  const cli = vi.fn();
  const run = vi.fn();
  const service = new PackageCommandService({
    getState: () => state,
    getDiscovery: () => ({
      targets: [],
      projectPaths: [],
      centralPackageFiles: [],
    }),
    getCli: cli,
    runOperation: run,
    refreshPackages: async () => {},
  });
  await service.upgradePackages();
  state.updates.evaluation = {
    candidates: [
      {
        key: "candidate",
        packageId: "Demo",
        projectPath: "/a.csproj",
        referenceIds: ["ref"],
        version: "1.5.0",
        feedUrls: ["feed"],
        compatibility: { status: "compatible", diagnostics: [] },
      },
    ],
    blocked: [],
  };
  await service.upgradePackages();
  await service.addOrUpgradeSelectedPackage("upgradeSelectedPackage", {});
  expect(cli).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});
