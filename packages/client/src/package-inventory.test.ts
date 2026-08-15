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

  it("throws when dotnet list package fails on both attempts", async () => {
    const log = logger();
    await expect(
      loadListedPackageInventory({
        target: target(),
        cli: cli([
          { code: 1, stdout: "" },
          { code: 1, stdout: "" },
        ]) as never,
        logger: log,
      }),
    ).rejects.toThrow(/exited with code 1/);
    expect(log.error).toHaveBeenCalledWith(
      "nuget.packages",
      expect.stringContaining("exited with code 1"),
    );
  });

  it("throws when dotnet list package succeeds but returns unparseable JSON", async () => {
    const log = logger();
    await expect(
      loadListedPackageInventory({
        target: target(),
        cli: cli([{ code: 0, stdout: "{" }]) as never,
        logger: log,
      }),
    ).rejects.toThrow(/Failed to parse/);
    expect(log.error).toHaveBeenCalledWith(
      "nuget.packages",
      expect.stringContaining("Failed to parse dotnet list package JSON"),
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
              topLevelPackages: [
                { id: "Newtonsoft.Json", resolvedVersion: "13.0.3" },
              ],
            },
          ],
        },
      ],
    });

    const runDotnet = vi
      .fn()
      .mockResolvedValueOnce({
        code: 1,
        stdout: restoreFailureJson,
        stderr: "",
      })
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

  it("retries with --no-restore even for non-restore-shaped errors", async () => {
    const runDotnet = vi
      .fn()
      .mockResolvedValueOnce({
        code: 1,
        stdout: "",
        stderr: "some other error",
      })
      .mockResolvedValueOnce({
        code: 1,
        stdout: "",
        stderr: "still some other error",
      });

    await expect(
      loadListedPackageInventory({
        target: target(),
        cli: { runDotnet } as never,
        logger: logger(),
      }),
    ).rejects.toThrow(/still some other error/);

    expect(runDotnet).toHaveBeenCalledTimes(2);
    expect(runDotnet).toHaveBeenNthCalledWith(
      2,
      expect.arrayContaining(["--no-restore"]),
    );
  });

  it("throws with diagnostic message when --no-restore retry also fails", async () => {
    const restoreFailureJson = JSON.stringify({
      version: 1,
      problems: [{ text: "Restore failed.", level: "error" }],
    });

    const runDotnet = vi
      .fn()
      .mockResolvedValueOnce({
        code: 1,
        stdout: restoreFailureJson,
        stderr: "",
      })
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "still broken" });

    await expect(
      loadListedPackageInventory({
        target: target(),
        cli: { runDotnet } as never,
        logger: logger(),
      }),
    ).rejects.toThrow(/still broken/);

    expect(runDotnet).toHaveBeenCalledTimes(2);
  });

  it("retries with --no-restore for a TreatWarningsAsErrors-style failure without a literal 'Restore failed' match", async () => {
    const warningsAsErrorsJson = JSON.stringify({
      version: 1,
      problems: [
        {
          level: "error",
          text: "error NU1903: Package 'Foo' 1.0.0 has a known high severity vulnerability (warning promoted to error by TreatWarningsAsErrors)",
        },
      ],
    });

    const runDotnet = vi
      .fn()
      .mockResolvedValueOnce({
        code: 1,
        stdout: warningsAsErrorsJson,
        stderr: "",
      })
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "" });

    await expect(
      loadListedPackageInventory({
        target: target(),
        cli: { runDotnet } as never,
        logger: logger(),
      }),
    ).rejects.toThrow(/exited with code 1/);

    expect(runDotnet).toHaveBeenCalledTimes(2);
    expect(runDotnet).toHaveBeenNthCalledWith(
      2,
      expect.arrayContaining(["--no-restore"]),
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
    ).rejects.toThrow(/Failed to parse/);
    expect(log.error).toHaveBeenCalledWith(
      "nuget.packages",
      expect.stringContaining(
        "Failed to parse dotnet list package --outdated JSON",
      ),
    );
  });

  it("throws when dotnet list package --outdated fails on both attempts", async () => {
    const log = logger();
    await expect(
      loadOutdatedPackageVersions({
        target: target(),
        cli: cli([
          { code: 1, stdout: "" },
          { code: 1, stdout: "" },
        ]) as never,
        logger: log,
      }),
    ).rejects.toThrow(/exited with code 1/);
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
      .mockResolvedValueOnce({
        code: 1,
        stdout: restoreFailureJson,
        stderr: "",
      })
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
  runDotnet.mockRejectedValue(
    new Error(
      "cli() test helper: no more queued results — did you forget the --no-restore retry entry?",
    ),
  );
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
