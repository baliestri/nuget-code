import { beforeEach, describe, expect, it } from "vitest";
import * as vscode from "vscode";
import { getSettings } from "./settings.js";
import fs from "node:fs";

const vscodeMock = vscode as unknown as {
  __resetVscodeMock(): void;
  __setConfiguration(
    section: "nuget-code" | "http",
    values: Record<string, unknown>,
  ): void;
  workspace: {
    workspaceFile: { fsPath: string } | undefined;
    workspaceFolders:
      | Array<{ uri: { fsPath: string; toString: () => string } }>
      | undefined;
  };
};

describe("extension settings", () => {
  it("registers Source Save In under VS Code configuration contributions", () => {
    const manifest = JSON.parse(
      fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    expect(manifest.configuration).toBeUndefined();
    expect(
      manifest.contributes.configuration.properties[
        "nuget-code.sources.saveIn"
      ],
    ).toMatchObject({ type: "string", default: "workspace" });
    vscodeMock.__setConfiguration("nuget-code", { "sources.saveIn": "user" });
    expect(getSettings().sourceSaveIn).toBe("user");
  });
  beforeEach(() => {
    vscodeMock.__resetVscodeMock();
  });

  it("reads extension settings and VS Code proxy defaults", () => {
    vscodeMock.__setConfiguration("nuget-code", {
      tabButtonStyle: "icons",
      logLevel: "debug",
      maxLogEntries: 50,
      defaultFeed: "nuget",
      includePrerelease: true,
      maxSearchResults: 25,
      dotnetPath: "dotnet-custom",
      nugetPath: "nuget-custom",
      extraConfigPaths: ["a.config"],
      credentialProviderPaths: ["provider.exe"],
      proxy: "",
      useVsCodeProxy: true,
      calculateCacheSizesOnLoad: true,
    });
    vscodeMock.__setConfiguration("http", { proxy: "http://proxy" });
    vscodeMock.workspace.workspaceFile = { fsPath: "c:/repo/App.sln" };

    expect(getSettings()).toEqual({
      sourceSaveIn: "workspace",
      tabButtonStyle: "icons",
      logLevel: "debug",
      maxLogEntries: 50,
      defaultFeed: "nuget",
      includePrerelease: true,
      maxSearchResults: 25,
      dotnetPath: "dotnet-custom",
      nugetPath: "nuget-custom",
      extraConfigPaths: ["a.config"],
      credentialProviderPaths: ["provider.exe"],
      proxy: "http://proxy",
      workspacePath: "c:/repo",
      useVsCodeProxy: true,
      calculateCacheSizesOnLoad: true,
    });
  });

  it("uses explicit proxy and workspace folder fallback", () => {
    vscodeMock.__setConfiguration("nuget-code", {
      proxy: "http://explicit",
      useVsCodeProxy: false,
    });
    vscodeMock.workspace.workspaceFolders = [
      { uri: { fsPath: "c:/folder", toString: () => "file:///c:/folder" } },
    ];

    expect(getSettings()).toMatchObject({
      proxy: "http://explicit",
      workspacePath: "c:/folder",
      tabButtonStyle: "labels",
    });
  });
});
