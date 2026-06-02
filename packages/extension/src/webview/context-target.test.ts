import { describe, expect, it } from "vitest";
import {
  contextItemPath,
  resolveTargetFromContextPath,
} from "./context-target.js";
import type { WorkspaceTarget } from "#contracts";

describe("context target helpers", () => {
  it("extracts paths from common VS Code and ReSharper context shapes", () => {
    expect(contextItemPath("c:/repo/App.sln")).toBe("c:/repo/App.sln");
    expect(contextItemPath({ fsPath: "c:/repo/App.csproj" })).toBe(
      "c:/repo/App.csproj",
    );
    expect(
      contextItemPath({
        resourceUri: { fsPath: "c:/repo/src/Api/Api.csproj" },
      }),
    ).toBe("c:/repo/src/Api/Api.csproj");
    expect(contextItemPath({ uri: { path: "c:/repo/file.cs" } })).toBe(
      "c:/repo/file.cs",
    );
    expect(contextItemPath({ unknown: true })).toBeUndefined();
  });

  it("resolves exact solution and project targets", () => {
    expect(resolveTargetFromContextPath("c:/repo/App.sln", targets())?.id).toBe(
      "solution:c:/repo/App.sln",
    );
    expect(
      resolveTargetFromContextPath("c:/repo/src/App/App.csproj", targets())?.id,
    ).toBe("project:c:/repo/src/App/App.csproj");
  });

  it("resolves files and folders to the nearest parent project", () => {
    expect(
      resolveTargetFromContextPath(
        "c:/repo/src/App/Features/Home.cs",
        targets(),
      )?.id,
    ).toBe("project:c:/repo/src/App/App.csproj");
    expect(
      resolveTargetFromContextPath("c:/repo/src/App.Tests", targets())?.id,
    ).toBe("project:c:/repo/src/App.Tests/App.Tests.csproj");
  });

  it("returns undefined when no context target matches", () => {
    expect(
      resolveTargetFromContextPath("c:/other/Other.csproj", targets()),
    ).toBeUndefined();
    expect(resolveTargetFromContextPath(undefined, targets())).toBeUndefined();
  });
});

function targets(): WorkspaceTarget[] {
  return [
    {
      id: "solution:c:/repo/App.sln",
      kind: "solution",
      name: "App.sln",
      path: "c:/repo/App.sln",
      projectPaths: ["c:/repo/src/App/App.csproj"],
    },
    {
      id: "project:c:/repo/src/App/App.csproj",
      kind: "project",
      name: "App",
      path: "c:/repo/src/App/App.csproj",
      projectPaths: ["c:/repo/src/App/App.csproj"],
    },
    {
      id: "project:c:/repo/src/App.Tests/App.Tests.csproj",
      kind: "project",
      name: "App.Tests",
      path: "c:/repo/src/App.Tests/App.Tests.csproj",
      projectPaths: ["c:/repo/src/App.Tests/App.Tests.csproj"],
    },
  ];
}
