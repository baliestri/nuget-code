import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PackageFeed, SourceEdit } from "#contracts";
import { editPackageSource } from "./source-edits";
import {
  checkedDotnet,
  fixtureCli,
  selectInstalledSdk,
} from "./test/dotnet-fixture";

describe("source edits against the installed NuGet SDK", () => {
  let root: string;
  let child: string;
  let config: string;
  const empty = "<configuration />";
  const feed = (name: string, url: string, enabled = true): PackageFeed => ({
    id: name,
    name,
    url,
    enabled,
  });
  const edit = (
    name: string,
    url: string,
    extra: Partial<SourceEdit> = {},
  ): SourceEdit => ({
    action: "upsert",
    name,
    url,
    enabled: true,
    allowInsecure: false,
    ...extra,
  });

  beforeEach(async () => {
    vi.stubEnv("DOTNET_CLI_UI_LANGUAGE", "en-US");
    root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "nuget-source-edits-")),
    );
    child = path.join(root, "workspace");
    config = path.join(child, "NuGet.Config");
    await fs.mkdir(child);
    const sdkVersion = await selectInstalledSdk(
      fixtureCli(root),
      root,
      Number(process.env.SDK_MAJOR),
    );
    await fs.writeFile(
      path.join(root, "global.json"),
      JSON.stringify({ sdk: { version: sdkVersion, rollForward: "disable" } }),
    );
    // Stop inherited machine/user sources at the disposable fixture boundary.
    await fs.writeFile(
      path.join(root, "NuGet.Config"),
      '<configuration><packageSources><clear/><add key="Inherited" value="https://inherited.example/v3/index.json"/><add key="Keep" value="./feed"/></packageSources><disabledPackageSources><clear/><add key="Keep" value="true"/></disabledPackageSources></configuration>',
    );
    await fs.writeFile(config, empty);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  async function list(explicit = false, cwd = child) {
    const result = await checkedDotnet(
      fixtureCli(root),
      [
        "nuget",
        "list",
        "source",
        ...(explicit ? ["--configfile", config] : []),
      ],
      cwd,
    );
    return [
      ...result.stdout.matchAll(
        /^\s*\d+\.\s+(.+?)\s+\[(Enabled|Disabled)\]\s*\r?\n\s+(.+)$/gm,
      ),
    ].map((match) => ({
      name: match[1],
      enabled: match[2] === "Enabled",
      url: match[3]!.trim(),
    }));
  }

  async function apply(change: SourceEdit, effective?: PackageFeed[]) {
    await fs.writeFile(
      config,
      editPackageSource(await fs.readFile(config, "utf8"), change, effective),
    );
  }

  it("treats a disabledPackageSources key as disabled even when its value is false", async () => {
    const xml =
      '<configuration><packageSources><add key="Probe" value="https://probe.example/v3/index.json"/></packageSources><disabledPackageSources><add key="Probe" value="false"/></disabledPackageSources></configuration>';
    await fs.writeFile(config, xml);
    expect(await list(true)).toEqual([
      {
        name: "Probe",
        enabled: false,
        url: "https://probe.example/v3/index.json",
      },
    ]);
  });

  it("adds, edits, disables and enables a relative source in an explicit config", async () => {
    await apply(edit("Local", "./packages"));
    expect(await list(true)).toEqual([
      { name: "Local", enabled: true, url: path.join(child, "packages") },
    ]);
    await apply(
      edit("Local", "../new-feed", { originalName: "Local", enabled: false }),
    );
    expect(await list(true)).toEqual([
      { name: "Local", enabled: false, url: path.join(root, "new-feed") },
    ]);
    await apply(edit("Local", "../new-feed", { originalName: "Local" }));
    expect(await list(true)).toEqual([
      { name: "Local", enabled: true, url: path.join(root, "new-feed") },
    ]);
  });

  it("removes an inherited source with clear while preserving other paths and disabled state", async () => {
    expect(await list()).toHaveLength(2);
    await apply(
      edit("Inherited", "", { action: "remove", originalName: "Inherited" }),
      [
        feed("Inherited", "https://inherited.example/v3/index.json"),
        feed("Keep", path.join(root, "feed"), false),
      ],
    );
    expect(await list()).toEqual([
      { name: "Keep", enabled: false, url: path.join(root, "feed") },
    ]);
    expect(await list(true)).toEqual(await list());
    expect(await fs.readFile(config, "utf8")).toContain("<clear />");
  });

  it("renames an inherited source without retaining its old identity", async () => {
    await apply(
      edit("Renamed", "https://renamed.example/v3/index.json", {
        originalName: "Inherited",
      }),
      [
        {
          ...feed("Inherited", "https://inherited.example/v3/index.json"),
          sourceAttributes: { protocolVersion: "3" },
        },
        feed("Keep", path.join(root, "feed"), false),
      ],
    );
    expect(await list()).toEqual([
      { name: "Keep", enabled: false, url: path.join(root, "feed") },
      {
        name: "Renamed",
        enabled: true,
        url: "https://renamed.example/v3/index.json",
      },
    ]);
    expect(await list(true)).toEqual(await list());
    expect(await fs.readFile(config, "utf8")).toContain('protocolVersion="3"');
  });

  it("enables a disabled inherited source while retaining other inherited sources", async () => {
    await apply(
      edit("Keep", path.join(root, "feed"), { originalName: "Keep" }),
      [
        feed("Inherited", "https://inherited.example/v3/index.json"),
        feed("Keep", path.join(root, "feed"), false),
      ],
    );
    expect(
      (await list()).sort((a, b) => a.name!.localeCompare(b.name!)),
    ).toEqual([
      {
        name: "Inherited",
        enabled: true,
        url: "https://inherited.example/v3/index.json",
      },
      { name: "Keep", enabled: true, url: path.join(root, "feed") },
    ]);
  });

  it("honors descendant overrides after an ancestor edit", async () => {
    const descendant = path.join(child, "project");
    await fs.mkdir(descendant);
    await fs.writeFile(
      path.join(descendant, "NuGet.Config"),
      '<configuration><packageSources><add key="Inherited" value="https://descendant.example/v3/index.json"/></packageSources><disabledPackageSources><add key="Inherited" value="true"/></disabledPackageSources></configuration>',
    );
    await apply(
      edit("Inherited", "https://edited.example/v3/index.json", {
        originalName: "Inherited",
      }),
    );
    expect(await list()).toContainEqual({
      name: "Inherited",
      enabled: true,
      url: "https://edited.example/v3/index.json",
    });
    expect(await list(false, descendant)).toContainEqual({
      name: "Inherited",
      enabled: false,
      url: "https://descendant.example/v3/index.json",
    });
  });

  it("reveals an ancestor source when removing only a concrete override", async () => {
    await fs.writeFile(
      config,
      '<configuration><packageSources><add key="Inherited" value="https://override.example/v3/index.json"/></packageSources></configuration>',
    );
    await apply(
      edit("Inherited", "", { action: "remove", originalName: "Inherited" }),
    );
    expect(await list(true)).toEqual([]);
    expect(await list()).toContainEqual({
      name: "Inherited",
      enabled: true,
      url: "https://inherited.example/v3/index.json",
    });
  });
});
