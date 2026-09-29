import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadInstalledReferences } from "./package-inventory";

const logger = {
  error: vi.fn(),
  warning: vi.fn(),
  information: vi.fn(),
  verbose: vi.fn(),
};
const app = path.resolve("apps", "A", "A.csproj");
const other = path.resolve("apps", "B", "B.csproj");
const target = {
  id: "solution",
  name: "App",
  kind: "solution" as const,
  path: path.resolve("App.slnx"),
  projectPaths: [app, other],
};
function payload(projectPath: string) {
  return {
    version: 1,
    projects: [
      {
        path: projectPath,
        frameworks: [
          {
            framework: "net8.0",
            topLevelPackages: [
              {
                id: "Demo",
                requestedVersion: "[1,2)",
                resolvedVersion: "1.0.0",
              },
            ],
          },
          {
            framework: "net9.0",
            topLevelPackages: [
              {
                id: "Demo",
                requestedVersion: "2.0.0",
                resolvedVersion: "2.0.0",
              },
            ],
            transitivePackages: [
              { id: "Transitive", resolvedVersion: "1.0.0" },
            ],
          },
        ],
      },
    ],
  };
}

describe("installed reference facts", () => {
  it("queries each solution project with its own SDK and preserves frameworks", async () => {
    const runDotnet = vi.fn(async (args: string[], cwd: string) => ({
      code: 0,
      stderr: "",
      stdout:
        args[0] === "--version"
          ? cwd === path.dirname(app)
            ? "8.0.425"
            : "10.0.401"
          : JSON.stringify(payload(cwd === path.dirname(app) ? app : other)),
    }));
    const result = await loadInstalledReferences({
      target,
      cli: { runDotnet } as never,
      logger,
    });
    expect(result).toHaveLength(6);
    expect(
      result
        .filter((r) => r.projectPath === app)
        .map((r) => [r.framework, r.resolvedVersion, r.direct]),
    ).toEqual([
      ["net8.0", "1.0.0", true],
      ["net9.0", "2.0.0", true],
      ["net9.0", "1.0.0", false],
    ]);
    expect(new Set(result.map((r) => r.referenceId)).size).toBe(6);
    expect(
      result.every(
        (r) =>
          r.declarationPath === null && r.affectedProjectPaths.length === 0,
      ),
    ).toBe(true);
    const queries = runDotnet.mock.calls.filter(([args]) =>
      args.includes("--format"),
    );
    expect(queries[0]?.[0].slice(0, 3)).toEqual(["list", app, "package"]);
    expect(queries[1]?.[0].slice(0, 4)).toEqual([
      "package",
      "list",
      "--project",
      other,
    ]);
    expect(
      runDotnet.mock.calls.every(([args]) => !args.includes(target.path)),
    ).toBe(true);
  });

  it("does not pretend that a requested range is a resolved version", async () => {
    const runDotnet = vi.fn(async (args: string[]) => ({
      code: 0,
      stderr: "",
      stdout:
        args[0] === "--version"
          ? "8.0.425"
          : JSON.stringify({
              projects: [
                {
                  path: app,
                  frameworks: [
                    {
                      framework: "net8.0",
                      topLevelPackages: [
                        { id: "Demo", requestedVersion: "[1,2)" },
                      ],
                    },
                  ],
                },
              ],
            }),
    }));
    const result = await loadInstalledReferences({
      target: { ...target, projectPaths: [app] },
      cli: { runDotnet } as never,
      logger,
    });
    expect(result[0]).toMatchObject({
      requestedVersion: "[1,2)",
      resolvedVersion: null,
    });
  });

  it.each([8, 9, 10])(
    "uses retry only when supported by SDK %s",
    async (major) => {
      const runDotnet = vi.fn(async (args: string[]) =>
        args[0] === "--version"
          ? { code: 0, stdout: `${major}.0.100`, stderr: "" }
          : { code: 1, stdout: "", stderr: "restore required" },
      );
      await expect(
        loadInstalledReferences({
          target: { ...target, projectPaths: [app] },
          cli: { runDotnet } as never,
          logger,
        }),
      ).rejects.toThrow("restore required");
      const queries = runDotnet.mock.calls.filter(([args]) =>
        args.includes("--format"),
      );
      expect(queries).toHaveLength(major >= 10 ? 2 : 1);
      expect(queries.some(([args]) => args.includes("--no-restore"))).toBe(
        major >= 10,
      );
    },
  );

  it("rejects results belonging to a different project", async () => {
    const runDotnet = vi.fn(async (args: string[]) => ({
      code: 0,
      stderr: "",
      stdout:
        args[0] === "--version" ? "10.0.401" : JSON.stringify(payload(other)),
    }));
    await expect(
      loadInstalledReferences({
        target: { ...target, projectPaths: [app] },
        cli: { runDotnet } as never,
        logger,
      }),
    ).rejects.toThrow(/different project/i);
  });

  it("does not invoke the CLI without a selected project", async () => {
    const runDotnet = vi.fn();
    expect(
      await loadInstalledReferences({
        target: undefined,
        cli: { runDotnet } as never,
        logger,
      }),
    ).toEqual([]);
    expect(
      await loadInstalledReferences({
        target: { ...target, projectPaths: [] },
        cli: { runDotnet } as never,
        logger,
      }),
    ).toEqual([]);
    expect(runDotnet).not.toHaveBeenCalled();
  });
});
