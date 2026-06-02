import { describe, expect, it, vi } from "vitest";
import {
  applyOutdatedPackageVersions,
  loadListedPackageInventory,
  loadOutdatedPackageVersions,
  loadPackageInventory,
} from "./package-inventory.js";
import type { NuGetClientLogger } from "./types.js";
import type { PackageInventory } from "./package-types.js";

describe("package inventory", () => {
  it("returns empty inventory without a target", async () => {
    await expect(
      loadListedPackageInventory({
        target: undefined,
        cli: cli([]) as never,
        logger: logger(),
      }),
    ).resolves.toEqual({ installed: [], implicit: [] });
  });

  it("parses dotnet list package JSON into installed and implicit packages", async () => {
    const runDotnet = vi.fn().mockResolvedValue({
      code: 0,
      stdout: JSON.stringify({
        projects: [
          {
            path: "src/App.csproj",
            frameworks: [
              {
                framework: "net8.0",
                topLevelPackages: [
                  {
                    id: "Newtonsoft.Json",
                    requestedVersion: "13.0.1",
                    resolvedVersion: "13.0.3",
                  },
                ],
                transitivePackages: [
                  { id: "System.Memory", resolvedVersion: "4.5.5" },
                ],
              },
            ],
          },
          {
            path: "src/Api.csproj",
            frameworks: [
              {
                framework: "net8.0",
                topLevelPackages: [
                  { id: "Newtonsoft.Json", resolvedVersion: "13.0.3" },
                ],
              },
            ],
          },
        ],
      }),
    });

    const inventory = await loadListedPackageInventory({
      target: target(),
      cli: { runDotnet } as never,
      logger: logger(),
    });

    expect(runDotnet).toHaveBeenCalledWith([
      "list",
      "App.sln",
      "package",
      "--include-transitive",
      "--format",
      "json",
    ]);
    expect(inventory.installed).toHaveLength(1);
    expect(inventory.installed[0]).toMatchObject({
      name: "Newtonsoft.Json",
      installedVersion: "13.0.3",
      projectPaths: ["src/App.csproj", "src/Api.csproj"],
    });
    expect(inventory.implicit[0]).toMatchObject({
      name: "System.Memory",
      implicit: true,
      installedVersion: "4.5.5",
    });
  });

  it("logs and returns empty inventory for command or JSON failures", async () => {
    await expect(
      loadListedPackageInventory({
        target: target(),
        cli: cli([{ code: 1, stdout: "" }]) as never,
        logger: logger(),
      }),
    ).resolves.toEqual({ installed: [], implicit: [] });

    const log = logger();
    await expect(
      loadListedPackageInventory({
        target: target(),
        cli: cli([{ code: 0, stdout: "{" }]) as never,
        logger: log,
      }),
    ).resolves.toEqual({ installed: [], implicit: [] });
    expect(log.warning).toHaveBeenCalledWith(
      "nuget.packages",
      expect.stringContaining("Failed to parse dotnet package list JSON"),
    );
  });

  it("applies outdated versions and loads full inventory", async () => {
    const inventory: PackageInventory = {
      installed: [
        {
          id: "a",
          name: "Demo",
          installedVersion: "1.0.0",
          projectPaths: ["src/App.csproj"],
          versions: [{ version: "1.0.0", source: "Installed" }],
          dependencyGroups: [],
        },
      ],
      implicit: [],
    };

    expect(
      applyOutdatedPackageVersions(inventory, new Map([["demo", "2.0.0"]]))
        .installed[0],
    ).toMatchObject({
      availableVersion: "2.0.0",
      versions: [
        { version: "2.0.0", source: "NuGet" },
        { version: "1.0.0", source: "Installed" },
      ],
    });

    const runDotnet = vi
      .fn()
      .mockResolvedValueOnce({
        code: 0,
        stdout: JSON.stringify({
          projects: [
            {
              path: "src/App.csproj",
              frameworks: [
                {
                  framework: "net8.0",
                  topLevelPackages: [{ id: "Demo", resolvedVersion: "1.0.0" }],
                },
              ],
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        code: 0,
        stdout: JSON.stringify({
          projects: [
            {
              path: "src/App.csproj",
              frameworks: [
                {
                  framework: "net8.0",
                  topLevelPackages: [{ id: "Demo", latestVersion: "2.0.0" }],
                },
              ],
            },
          ],
        }),
      });

    await expect(
      loadPackageInventory({
        target: target(),
        cli: { runDotnet } as never,
        logger: logger(),
      }),
    ).resolves.toMatchObject({
      installed: [{ name: "Demo", availableVersion: "2.0.0" }],
    });
  });

  it("loads outdated package versions and handles parse failures", async () => {
    await expect(
      loadOutdatedPackageVersions({
        target: undefined,
        cli: cli([]) as never,
        logger: logger(),
      }),
    ).resolves.toEqual(new Map());

    await expect(
      loadOutdatedPackageVersions({
        target: target(),
        cli: cli([
          {
            code: 0,
            stdout: JSON.stringify({
              projects: [
                {
                  frameworks: [
                    {
                      topLevelPackages: [{ id: "A", latestVersion: "2.0.0" }],
                      transitivePackages: [{ id: "B", latestVersion: "3.0.0" }],
                    },
                  ],
                },
              ],
            }),
          },
        ]) as never,
        logger: logger(),
      }),
    ).resolves.toEqual(
      new Map([
        ["a", "2.0.0"],
        ["b", "3.0.0"],
      ]),
    );

    const log = logger();
    await expect(
      loadOutdatedPackageVersions({
        target: target(),
        cli: cli([{ code: 0, stdout: "{" }]) as never,
        logger: log,
      }),
    ).resolves.toEqual(new Map());
    expect(log.warning).toHaveBeenCalledWith(
      "nuget.packages",
      expect.stringContaining("Failed to parse dotnet outdated package JSON"),
    );
  });
});

function target() {
  return {
    id: "app",
    kind: "solution" as const,
    name: "App",
    path: "App.sln",
    projectPaths: ["src/App.csproj"],
  };
}

function cli(results: Array<{ code: number; stdout: string }>) {
  const runDotnet = vi.fn();
  for (const result of results) {
    runDotnet.mockResolvedValueOnce({ stderr: "", ...result });
  }
  return { runDotnet };
}

function logger(): NuGetClientLogger {
  return {
    verbose: vi.fn(),
    information: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  };
}
