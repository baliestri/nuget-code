import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import fs from "node:fs/promises";
import { discoverWorkspace } from "./discovery.js";
import type { ExtensionLogger } from "./logger.js";

vi.mock("node:fs/promises", () => ({
  default: { readFile: vi.fn() },
}));

const vscodeMock = vscode as typeof vscode & {
  __resetVscodeMock(): void;
};
const readFile = vi.mocked(fs.readFile);

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
      solutions: ["D:/repo/App.sln"],
      projects: [
        "D:/repo/src/App/App.csproj",
        "D:/repo/src/Other/Other.csproj",
      ],
    });
    readFile.mockResolvedValue(
      [
        "Microsoft Visual Studio Solution File, Format Version 12.00",
        'Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "App", "src\\App\\App.csproj", "{11111111-1111-1111-1111-111111111111}"',
        "EndProject",
        'Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "Solution Items", "Solution Items", "{GUID2}"',
        "EndProject",
      ].join("\n") as never,
    );

    const discovery = await discoverWorkspace(fakeLogger());
    const solution = discovery.targets.find((t) => t.kind === "solution");

    expect(solution?.projectPaths).toEqual(["D:/repo/src/App/App.csproj"]);
  });

  it("parses .slnx projects, including ones nested under a Folder", async () => {
    mockFindFiles({
      solutions: ["D:/repo/App.slnx"],
      projects: ["D:/repo/src/App/App.csproj", "D:/repo/src/Lib/Lib.csproj"],
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
      ["D:/repo/src/App/App.csproj", "D:/repo/src/Lib/Lib.csproj"].sort(),
    );
  });

  it("drops a solution-referenced project that was not discovered on disk", async () => {
    mockFindFiles({
      solutions: ["D:/repo/App.sln"],
      projects: ["D:/repo/src/App/App.csproj"],
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

    expect(solution?.projectPaths).toEqual(["D:/repo/src/App/App.csproj"]);
  });

  it("logs a warning and yields an empty project list when a solution file can't be read", async () => {
    mockFindFiles({
      solutions: ["D:/repo/App.sln"],
      projects: ["D:/repo/src/App/App.csproj"],
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
      solutions: ["D:/repo/A.sln", "D:/repo/B.sln"],
      projects: ["D:/repo/src/A/A.csproj", "D:/repo/src/B/B.csproj"],
    });
    readFile.mockImplementation((filePath: unknown) => {
      if (filePath === "D:/repo/A.sln") {
        return Promise.resolve(
          'Project("{11111111-1111-1111-1111-111111111111}") = "A", "src\\A\\A.csproj", "{11111111-1111-1111-1111-111111111111}"\nEndProject' as never,
        );
      }
      return Promise.resolve(
        'Project("{11111111-1111-1111-1111-111111111111}") = "B", "src\\B\\B.csproj", "{11111111-1111-1111-1111-111111111111}"\nEndProject' as never,
      );
    });

    const discovery = await discoverWorkspace(fakeLogger());
    const solutionA = discovery.targets.find((t) => t.path === "D:/repo/A.sln");
    const solutionB = discovery.targets.find((t) => t.path === "D:/repo/B.sln");

    expect(solutionA?.projectPaths).toEqual(["D:/repo/src/A/A.csproj"]);
    expect(solutionB?.projectPaths).toEqual(["D:/repo/src/B/B.csproj"]);
  });
});
