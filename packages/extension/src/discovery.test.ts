import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import fs from "node:fs/promises";
import path from "node:path";
import { discoverWorkspace } from "./discovery.js";
import type { ExtensionLogger } from "./logger.js";

vi.mock("node:fs/promises", () => ({
  default: { readFile: vi.fn() },
}));

const vscodeMock = vscode as typeof vscode & {
  __resetVscodeMock(): void;
};
const readFile = vi.mocked(fs.readFile);

// Built via node:path so absolute paths resolve consistently on whatever
// platform the tests run on (Windows locally, Linux in CI), matching how
// discovery.ts itself resolves paths at runtime.
const repoRoot = path.resolve(path.sep, "repo");
const appSln = path.join(repoRoot, "App.sln");
const appSlnx = path.join(repoRoot, "App.slnx");
const aSln = path.join(repoRoot, "A.sln");
const bSln = path.join(repoRoot, "B.sln");
const appCsproj = path.join(repoRoot, "src", "App", "App.csproj");
const otherCsproj = path.join(repoRoot, "src", "Other", "Other.csproj");
const libCsproj = path.join(repoRoot, "src", "Lib", "Lib.csproj");
const aCsproj = path.join(repoRoot, "src", "A", "A.csproj");
const bCsproj = path.join(repoRoot, "src", "B", "B.csproj");

function uri(fsPath: string) {
  return { fsPath };
}

function fakeLogger(): ExtensionLogger {
  return {
    information: vi.fn(),
    verbose: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  } as never;
}

function mockFindFiles(options: {
  solutions?: string[];
  projects?: string[];
  centralPackages?: string[];
}): void {
  vi.mocked(vscode.workspace.findFiles).mockImplementation(((
    pattern: unknown,
  ) => {
    if (pattern === "**/*.{sln,slnx}") {
      return Promise.resolve((options.solutions ?? []).map(uri));
    }
    if (pattern === "**/*.{csproj,fsproj,vbproj}") {
      return Promise.resolve((options.projects ?? []).map(uri));
    }
    return Promise.resolve((options.centralPackages ?? []).map(uri));
  }) as never);
}

describe("discoverWorkspace", () => {
  beforeEach(() => {
    vscodeMock.__resetVscodeMock();
    readFile.mockReset();
  });

  it("scopes a classic .sln solution to only its own referenced projects", async () => {
    mockFindFiles({
      solutions: [appSln],
      projects: [appCsproj, otherCsproj],
    });
    readFile.mockResolvedValue(
      [
        "Microsoft Visual Studio Solution File, Format Version 12.00",
        'Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "App", "src\\App\\App.csproj", "{11111111-1111-1111-1111-111111111111}"',
        "EndProject",
        'Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "Solution Items", "Solution Items", "{22222222-2222-2222-2222-222222222222}"',
        "EndProject",
      ].join("\n") as never,
    );

    const discovery = await discoverWorkspace(fakeLogger());
    const solution = discovery.targets.find((t) => t.kind === "solution");

    expect(solution?.projectPaths).toEqual([appCsproj]);
  });

  it("parses .slnx projects, including ones nested under a Folder", async () => {
    mockFindFiles({
      solutions: [appSlnx],
      projects: [appCsproj, libCsproj],
    });
    readFile.mockResolvedValue(
      [
        "<Solution>",
        '  <Project Path="src/App/App.csproj" />',
        '  <Folder Name="/src/">',
        '    <Project Path="src/Lib/Lib.csproj" />',
        "  </Folder>",
        "</Solution>",
      ].join("\n") as never,
    );

    const discovery = await discoverWorkspace(fakeLogger());
    const solution = discovery.targets.find((t) => t.kind === "solution");

    expect(solution?.projectPaths?.slice().sort()).toEqual(
      [appCsproj, libCsproj].sort(),
    );
  });

  it("drops a solution-referenced project that was not discovered on disk", async () => {
    mockFindFiles({
      solutions: [appSln],
      projects: [appCsproj],
    });
    readFile.mockResolvedValue(
      [
        'Project("{11111111-1111-1111-1111-111111111111}") = "App", "src\\App\\App.csproj", "{11111111-1111-1111-1111-111111111111}"',
        "EndProject",
        'Project("{11111111-1111-1111-1111-111111111111}") = "Missing", "src\\Missing\\Missing.csproj", "{11111111-1111-1111-1111-111111111111}"',
        "EndProject",
      ].join("\n") as never,
    );

    const discovery = await discoverWorkspace(fakeLogger());
    const solution = discovery.targets.find((t) => t.kind === "solution");

    expect(solution?.projectPaths).toEqual([appCsproj]);
  });

  it("logs a warning and yields an empty project list when a solution file can't be read", async () => {
    mockFindFiles({
      solutions: [appSln],
      projects: [appCsproj],
    });
    readFile.mockRejectedValue(new Error("EACCES"));
    const logger = fakeLogger();

    const discovery = await discoverWorkspace(logger);
    const solution = discovery.targets.find((t) => t.kind === "solution");

    expect(solution?.projectPaths).toEqual([]);
    expect(logger.warning).toHaveBeenCalledWith(
      "workspace",
      expect.stringContaining("Could not read solution file"),
    );
  });

  it("gives each of two sibling solutions only its own real members, not the union", async () => {
    mockFindFiles({
      solutions: [aSln, bSln],
      projects: [aCsproj, bCsproj],
    });
    readFile.mockImplementation((filePath: unknown) => {
      if (filePath === aSln) {
        return Promise.resolve(
          'Project("{11111111-1111-1111-1111-111111111111}") = "A", "src\\A\\A.csproj", "{11111111-1111-1111-1111-111111111111}"\nEndProject' as never,
        );
      }
      return Promise.resolve(
        'Project("{11111111-1111-1111-1111-111111111111}") = "B", "src\\B\\B.csproj", "{11111111-1111-1111-1111-111111111111}"\nEndProject' as never,
      );
    });

    const discovery = await discoverWorkspace(fakeLogger());
    const solutionA = discovery.targets.find((t) => t.path === aSln);
    const solutionB = discovery.targets.find((t) => t.path === bSln);

    expect(solutionA?.projectPaths).toEqual([aCsproj]);
    expect(solutionB?.projectPaths).toEqual([bCsproj]);
  });
});
