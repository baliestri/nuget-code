import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadSources } from "./config.js";
import type { NuGetClientLogger, NuGetClientSettings } from "./types.js";

describe("NuGet config loading", () => {
  const previousEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...previousEnv };
  });

  it("loads workspace config files, credentials, disabled sources, and effective config", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nuget-config-"));
    const configPath = path.join(root, "NuGet.config");
    await fs.writeFile(
      configPath,
      `<configuration>
        <packageSources>
          <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
          <add key="private" value="https://private/index.json" allowInsecureConnections="true" />
        </packageSources>
        <disabledPackageSources>
          <add key="private" value="true" />
        </disabledPackageSources>
        <packageSourceCredentials>
          <private>
            <add key="Username" value="u" />
          </private>
        </packageSourceCredentials>
      </configuration>`,
    );
    process.env["ProgramFiles(x86)"] = "";
    process.env.ProgramFiles = "";
    process.env.APPDATA = path.join(root, "missing-appdata");

    const sources = await loadSources(settings(), logger(), {
      workspaceConfigPaths: [configPath, configPath],
      workspaceFolderPaths: [root],
    });

    expect(sources[0]).toMatchObject({
      id: "__effective__",
      name: "[Effective NuGet.config]",
      hasCredentials: true,
    });
    expect(sources[0]?.feeds.map((feed) => feed.name)).toContain("private");
    expect(sources[1]).toMatchObject({
      id: configPath,
      origin: "workspace",
      hasCredentials: true,
    });
    expect(sources[1]?.feeds).toEqual([
      expect.objectContaining({
        name: "nuget.org",
        enabled: true,
        hasCredentials: false,
      }),
      expect.objectContaining({
        name: "private",
        enabled: false,
        allowInsecure: true,
        hasCredentials: true,
      }),
    ]);
  });

  it("falls back to nuget.org and logs unreadable configs", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nuget-config-bad-"));
    const badPath = path.join(root, "NuGet.config");
    await fs.writeFile(badPath, "<configuration>");
    process.env["ProgramFiles(x86)"] = "";
    process.env.ProgramFiles = "";
    process.env.APPDATA = path.join(root, "missing-appdata");

    const log = logger();
    const sources = await loadSources(settings(), log, {
      workspaceConfigPaths: [badPath],
      workspaceFolderPaths: [root],
    });

    expect(sources).toHaveLength(1);
    expect(sources[0]?.feeds).toEqual([
      expect.objectContaining({ name: "nuget.org", enabled: true }),
    ]);
    expect(log.warning).toHaveBeenCalledWith(
      "nuget.config",
      expect.stringContaining(`Failed to read ${badPath}`),
    );
  });
});

function settings(): NuGetClientSettings {
  return {
    dotnetPath: "dotnet",
    nugetPath: "nuget",
    extraConfigPaths: [],
    credentialProviderPaths: [],
    proxy: "",
    maxSearchResults: 20,
  };
}

function logger(): NuGetClientLogger {
  return {
    verbose: vi.fn(),
    information: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  };
}
