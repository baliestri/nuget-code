import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dotnetArguments, resolveDotnetSdk } from "./dotnet-sdk";
import {
  checkedDotnet,
  createDotnetFixture,
  type DotnetFixture,
} from "./test/dotnet-fixture";
import type { DotnetPackageList } from "./package-types";
import {
  loadInstalledReferences,
  loadListedPackageInventory,
} from "./package-inventory";
import { loadPackageCatalog } from "./package-catalog";

describe("real SDK package operations", () => {
  const major = Number(process.env.SDK_MAJOR);
  let fixture: DotnetFixture;
  beforeAll(async () => {
    fixture = await createDotnetFixture({ sdkMajor: major, layout: "simple" });
  });
  afterAll(async () => {
    await fixture?.dispose();
  });

  it("honors an ancestor global.json from the project directory", async () => {
    const sdk = await resolveDotnetSdk(fixture.cli, fixture.projectPath);
    expect(sdk).toEqual({
      version: fixture.sdkVersion,
      major,
      cwd: path.dirname(fixture.projectPath),
    });
  });

  it("reads real nupkg identities without filtering prereleases from the catalog", async () => {
    const catalog = await loadPackageCatalog({
      packageId: "Demo",
      feeds: [
        { id: "local", name: "Local", url: fixture.feedPath, enabled: true },
      ],
      settings: {
        dotnetPath: "dotnet",
        nugetPath: "nuget",
        credentialProviderPaths: [],
        extraConfigPaths: [],
        proxy: "",
        maxSearchResults: 100,
      },
      logger: { error() {}, warning() {}, information() {}, verbose() {} },
    });
    expect(catalog.complete).toBe(true);
    expect(catalog.versions.map((v) => v.version)).toEqual([
      "1.0.0",
      "1.5.0",
      "2.0.0-beta",
    ]);
  });

  it("installs, lists, updates and removes a package using a local feed", async () => {
    const sdk = await resolveDotnetSdk(fixture.cli, fixture.projectPath);
    const list = async () => {
      const result = await checkedDotnet(
        fixture.cli,
        dotnetArguments(sdk, {
          kind: "list",
          projectPath: fixture.projectPath,
          outdated: false,
        }),
        sdk.cwd,
      );
      return JSON.parse(result.stdout) as DotnetPackageList;
    };
    for (const version of ["1.0.0", "1.5.0"]) {
      await checkedDotnet(
        fixture.cli,
        dotnetArguments(sdk, {
          kind: "add",
          projectPath: fixture.projectPath,
          packageId: "Demo",
          version,
        }),
        sdk.cwd,
      );
      const packages = (await list()).projects?.flatMap(
        (project) =>
          project.frameworks?.flatMap(
            (framework) => framework.topLevelPackages ?? [],
          ) ?? [],
      );
      expect(packages).toContainEqual(
        expect.objectContaining({ id: "Demo", resolvedVersion: version }),
      );
      if (version === "1.0.0") {
        const outdated = await checkedDotnet(
          fixture.cli,
          dotnetArguments(sdk, {
            kind: "list",
            projectPath: fixture.projectPath,
            outdated: true,
            noRestore: major >= 10,
          }),
          sdk.cwd,
        );
        const report = JSON.parse(outdated.stdout) as DotnetPackageList;
        const updates = report.projects?.flatMap(
          (project) =>
            project.frameworks?.flatMap(
              (framework) => framework.topLevelPackages ?? [],
            ) ?? [],
        );
        expect(updates).toContainEqual(
          expect.objectContaining({ id: "Demo", latestVersion: "1.5.0" }),
        );
      }
    }
    await checkedDotnet(
      fixture.cli,
      dotnetArguments(sdk, {
        kind: "remove",
        projectPath: fixture.projectPath,
        packageId: "Demo",
      }),
      sdk.cwd,
    );
    await checkedDotnet(fixture.cli, ["restore", fixture.projectPath], sdk.cwd);
    const packages = (await list()).projects?.flatMap(
      (project) =>
        project.frameworks?.flatMap(
          (framework) => framework.topLevelPackages ?? [],
        ) ?? [],
    );
    expect(packages?.some((item) => item.id === "Demo")).toBe(false);
    expect(await fs.readFile(fixture.projectPath, "utf8")).not.toContain(
      'Include="Demo"',
    );
  });

  it("reports an unavailable nested SDK instead of falling back to the workspace SDK", async () => {
    const globalFile = path.join(
      path.dirname(fixture.projectPath),
      "global.json",
    );
    await fs.writeFile(
      globalFile,
      JSON.stringify({ sdk: { version: "99.0.100", rollForward: "disable" } }),
    );
    try {
      await expect(
        resolveDotnetSdk(fixture.cli, fixture.projectPath),
      ).rejects.toMatchObject({ code: "pinned-unavailable" });
    } finally {
      await fs.rm(globalFile);
    }
    expect(
      (await resolveDotnetSdk(fixture.cli, fixture.projectPath)).version,
    ).toBe(fixture.sdkVersion);
  });

  it("reports malformed global.json as invalid configuration", async () => {
    const globalFile = path.join(
      path.dirname(fixture.projectPath),
      "global.json",
    );
    await fs.writeFile(globalFile, '{ "sdk": broken }');
    try {
      await expect(
        resolveDotnetSdk(fixture.cli, fixture.projectPath),
      ).rejects.toMatchObject({ code: "invalid-output" });
    } finally {
      await fs.rm(globalFile);
    }
  });

  it("lets the host apply global.json roll-forward policy", async () => {
    const globalFile = path.join(
      path.dirname(fixture.projectPath),
      "global.json",
    );
    await fs.writeFile(
      globalFile,
      JSON.stringify({
        sdk: {
          version: `${major}.0.100`,
          rollForward: "latestFeature",
          allowPrerelease: false,
        },
      }),
    );
    try {
      expect(
        (await resolveDotnetSdk(fixture.cli, fixture.projectPath)).major,
      ).toBe(major);
    } finally {
      await fs.rm(globalFile);
    }
  });

  it("loads reference facts and the display adapter for a discovered slnx target", async () => {
    const sdk = await resolveDotnetSdk(fixture.cli, fixture.projectPath);
    await checkedDotnet(
      fixture.cli,
      dotnetArguments(sdk, {
        kind: "add",
        projectPath: fixture.projectPath,
        packageId: "Demo",
        version: "1.0.0",
      }),
      sdk.cwd,
    );
    const options = {
      target: {
        id: "solution",
        kind: "solution" as const,
        name: "Fixture",
        path: path.join(fixture.root, "DiscoveryOnly.slnx"),
        projectPaths: [fixture.projectPath],
      },
      cli: fixture.cli,
      logger: { error() {}, warning() {}, information() {}, verbose() {} },
    };
    const references = await loadInstalledReferences(options);
    expect(references).toContainEqual(
      expect.objectContaining({
        projectPath: fixture.projectPath,
        framework: `net${major}.0`,
        packageId: "Demo",
        resolvedVersion: "1.0.0",
        direct: true,
        declarationPath: null,
        affectedProjectPaths: [],
      }),
    );
    const display = await loadListedPackageInventory(options);
    expect(display.installed).toContainEqual(
      expect.objectContaining({ name: "Demo", installedVersion: "1.0.0" }),
    );
  });
});

it.each(["multi", "central", "imports", "external"] as const)(
  "restores and evaluates the %s fixture under the requested SDK",
  async (layout) => {
    const fixture = await createDotnetFixture({
      sdkMajor: Number(process.env.SDK_MAJOR),
      layout,
    });
    try {
      const sdk = await resolveDotnetSdk(fixture.cli, fixture.projectPath);
      await checkedDotnet(
        fixture.cli,
        ["restore", fixture.projectPath],
        sdk.cwd,
      );
      const result = await checkedDotnet(
        fixture.cli,
        dotnetArguments(sdk, {
          kind: "list",
          projectPath: fixture.projectPath,
          outdated: false,
        }),
        sdk.cwd,
      );
      const frameworks =
        (JSON.parse(result.stdout) as DotnetPackageList).projects?.[0]
          ?.frameworks ?? [];
      expect(frameworks.map((item) => item.framework)).toContain(
        `net${sdk.major}.0`,
      );
      if (layout === "multi") {
        expect(frameworks.map((item) => item.framework)).toContain(
          "netstandard2.1",
        );
      } else {
        expect(
          frameworks.flatMap((item) => item.topLevelPackages ?? []),
        ).toContainEqual(
          expect.objectContaining({ id: "Demo", resolvedVersion: "1.0.0" }),
        );
      }
    } finally {
      await fixture.dispose();
    }
  },
);
