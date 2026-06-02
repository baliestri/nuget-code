import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { NuGetClient } from "#client";
import { loadPackageSources } from "./source-loader.js";

const vscodeMock = vscode as unknown as {
  __resetVscodeMock(): void;
  workspace: {
    workspaceFolders:
      | Array<{ uri: { fsPath: string; toString: () => string } }>
      | undefined;
  };
};

vi.mock("#client", () => ({
  NuGetClient: {
    loadSources: vi.fn(),
  },
}));

describe("loadPackageSources", () => {
  beforeEach(() => {
    vscodeMock.__resetVscodeMock();
    vi.mocked(NuGetClient.loadSources).mockReset().mockResolvedValue([]);
  });

  it("passes discovered workspace configs and folders to the client", async () => {
    vi.mocked(vscode.workspace.findFiles).mockResolvedValue([
      { fsPath: "c:/repo/NuGet.config" } as never,
      { fsPath: "c:/repo/src/NuGet.config" } as never,
    ]);
    vscodeMock.workspace.workspaceFolders = [
      { uri: { fsPath: "c:/repo", toString: () => "file:///c:/repo" } },
    ];
    const settings = { dotnetPath: "dotnet" };
    const logger = {};

    await loadPackageSources(settings as never, logger as never);

    expect(vscode.workspace.findFiles).toHaveBeenCalledWith(
      "**/{NuGet.config,nuget.config,NuGet.Config}",
      "**/{node_modules,bin,obj}/**",
    );
    expect(NuGetClient.loadSources).toHaveBeenCalledWith(settings, logger, {
      workspaceConfigPaths: [
        "c:/repo/NuGet.config",
        "c:/repo/src/NuGet.config",
      ],
      workspaceFolderPaths: ["c:/repo"],
    });
  });
});
