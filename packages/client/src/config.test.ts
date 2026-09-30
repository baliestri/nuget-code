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

  it("gives relative local feeds distinct identities based on their declaring config", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "nuget-config-relative-"),
    );
    try {
      const configs: string[] = [];
      for (const name of ["A", "B"]) {
        const directory = path.join(root, name);
        await fs.mkdir(directory);
        const file = path.join(directory, "NuGet.Config");
        await fs.writeFile(
          file,
          `<configuration><packageSources><add key="local-${name}" value="packages"/></packageSources></configuration>`,
        );
        configs.push(file);
      }
      const sources = await loadSources(settings(), logger(), {
        workspaceConfigPaths: configs,
      });
      expect(
        sources[0]?.feeds.find((feed) => feed.name === "local-A")?.url,
      ).toBe(path.join(root, "A", "packages"));
      expect(
        sources[0]?.feeds.find((feed) => feed.name === "local-B")?.url,
      ).toBe(path.join(root, "B", "packages"));
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 5 });
    }
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

  it("limits effective sources to project ancestors and honors clear/remove and inherited disable directives", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "nuget-scoped-config-"),
    );
    try {
      const a = path.join(root, "A");
      const b = path.join(root, "B");
      const artifact = path.join(root, "artifacts", "review");
      for (const folder of [a, b, artifact])
        await fs.mkdir(folder, { recursive: true });
      const configs = [root, a, b, artifact].map((folder) =>
        path.join(folder, "NuGet.Config"),
      );
      await fs.writeFile(
        configs[0]!,
        '<configuration><packageSources><clear/><add key="base" value="https://base.test/index.json"/><add key="removed" value="https://removed.test/index.json"/></packageSources></configuration>',
      );
      await fs.writeFile(
        configs[1]!,
        '<configuration><packageSources><remove key="removed"/><add key="private" value="https://a.test/index.json"/></packageSources><disabledPackageSources><add key="base" value="true"/></disabledPackageSources></configuration>',
      );
      await fs.writeFile(
        configs[2]!,
        '<configuration><packageSources><clear/><add key="private" value="https://b.test/index.json"/></packageSources></configuration>',
      );
      await fs.writeFile(
        configs[3]!,
        '<configuration><packageSources><add key="local-assuan" value="missing/artifacts/packages"/></packageSources></configuration>',
      );
      const options = {
        workspaceConfigPaths: configs,
        workspaceFolderPaths: [root],
        projectPaths: [path.join(a, "A.csproj")],
      };
      const sources = await loadSources(settings(), logger(), options);
      expect(
        sources.some(
          (source) => source.path === configs[3] || source.path === configs[2],
        ),
      ).toBe(false);
      expect(sources[0]?.feeds.map((feed) => feed.name).sort()).toEqual([
        "base",
        "private",
      ]);
      expect(
        sources[0]?.feeds.find((feed) => feed.name === "base")?.enabled,
      ).toBe(false);
      const union = await loadSources(settings(), logger(), {
        ...options,
        projectPaths: [...options.projectPaths, path.join(b, "B.csproj")],
      });
      expect(
        union[0]?.feeds.filter((feed) => feed.name === "private"),
      ).toHaveLength(2);
      expect(new Set(union[0]?.feeds.map((feed) => feed.id)).size).toBe(
        union[0]?.feeds.length,
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
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
