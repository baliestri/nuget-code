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

  it("retries with --no-restore when dotnet list package fails due to restore", async () => {
    const restoreFailureJson = JSON.stringify({
      version: 1,
      problems: [
        {
          text: "Restore failed. Run `dotnet restore` for more details on the issue.",
          level: "error",
        },
      ],
    });
    const packagesJson = JSON.stringify({
      projects: [
        {
          path: "src/App.csproj",
          frameworks: [
            {
              framework: "net8.0",
              topLevelPackages: [{ id: "Newtonsoft.Json", resolvedVersion: "13.0.3" }],
            },
          ],
        },
      ],
    });

    const runDotnet = vi
      .fn()
      .mockResolvedValueOnce({ code: 1, stdout: restoreFailureJson, stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: packagesJson, stderr: "" });
    const log = logger();

    const inventory = await loadListedPackageInventory({
      target: target(),
      cli: { runDotnet } as never,
      logger: log,
    });

    expect(runDotnet).toHaveBeenCalledTimes(2);
    expect(runDotnet).toHaveBeenNthCalledWith(2, [
      "list",
      "App.sln",
      "package",
      "--include-transitive",
      "--format",
      "json",
      "--no-restore",
    ]);
    expect(log.warning).toHaveBeenCalledWith(
      "nuget.cli",
      expect.stringContaining("retrying with --no-restore"),
    );
    expect(inventory.installed[0]).toMatchObject({ name: "Newtonsoft.Json" });
  });

  it("does not retry and returns empty when non-restore error occurs", async () => {
    const runDotnet = vi
      .fn()
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "some other error" });

    const inventory = await loadListedPackageInventory({
      target: target(),
      cli: { runDotnet } as never,
      logger: logger(),
    });

    expect(runDotnet).toHaveBeenCalledTimes(1);
    expect(inventory).toEqual({ installed: [], implicit: [] });
  });

  it("returns empty when --no-restore retry also fails", async () => {
    const restoreFailureJson = JSON.stringify({
      version: 1,
      problems: [{ text: "Restore failed.", level: "error" }],
    });

    const runDotnet = vi
      .fn()
      .mockResolvedValueOnce({ code: 1, stdout: restoreFailureJson, stderr: "" })
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "still broken" });

    const inventory = await loadListedPackageInventory({
      target: target(),
      cli: { runDotnet } as never,
      logger: logger(),
    });

    expect(runDotnet).toHaveBeenCalledTimes(2);
    expect(inventory).toEqual({ installed: [], implicit: [] });
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

  it("retries outdated check with --no-restore when restore fails", async () => {
    const restoreFailureJson = JSON.stringify({
      version: 1,
      problems: [{ text: "Restore failed.", level: "error" }],
    });
    const outdatedJson = JSON.stringify({
      projects: [
        {
          frameworks: [
            { topLevelPackages: [{ id: "Demo", latestVersion: "2.0.0" }] },
          ],
        },
      ],
    });

    const runDotnet = vi
      .fn()
      .mockResolvedValueOnce({ code: 1, stdout: restoreFailureJson, stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: outdatedJson, stderr: "" });
    const log = logger();

    const result = await loadOutdatedPackageVersions({
      target: target(),
      cli: { runDotnet } as never,
      logger: log,
    });

    expect(runDotnet).toHaveBeenCalledTimes(2);
    expect(runDotnet).toHaveBeenNthCalledWith(2, [
      "list",
      "App.sln",
      "package",
      "--outdated",
      "--include-transitive",
      "--format",
      "json",
      "--no-restore",
    ]);
    expect(log.warning).toHaveBeenCalledWith(
      "nuget.cli",
      expect.stringContaining("retrying with --no-restore"),
    );
    expect(result).toEqual(new Map([["demo", "2.0.0"]]));
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
