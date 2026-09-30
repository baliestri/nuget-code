import fs from "node:fs/promises";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { NuGetClient } from "#client";
import { candidateKey } from "#manager";
import { contextFixture } from "#client/test/project-context-fixture";
import {
  PackageDataAdapter,
  type DataEnvironment,
} from "./package-data-adapter";

it("captures canonical project proofs and refuses to verify a snapshot after an imported input changes", async () => {
  const fixture = await contextFixture(true);
  const adapter = new PackageDataAdapter(() => environment, {
    warning: vi.fn(),
    information: vi.fn(),
    verbose: vi.fn(),
    error: vi.fn(),
  } as never);
  const environment: DataEnvironment = {
    target: {
      id: "solution",
      name: "Solution",
      kind: "solution",
      path: path.join(fixture.root, "App.sln"),
      projectPaths: fixture.projects,
    },
    feeds: [
      {
        id: "local",
        name: "Local",
        enabled: true,
        url: fixture.options.feedUrls[0]!,
      },
    ],
    configPaths: [fixture.options.restoreConfigPath],
    allowedRoots: [fixture.root],
    settings: {
      ...fixture.options,
      dotnetPath: "dotnet",
      proxy: "",
      credentialProviderPaths: [],
      extraConfigPaths: [],
      maxSearchResults: 100,
    } as never,
    cli: fixture.cli,
    sourceRevision: "source",
  };
  try {
    for (const project of fixture.projects) {
      await fs.mkdir(path.join(path.dirname(project), "obj"), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(path.dirname(project), "obj", "project.assets.json"),
        JSON.stringify({
          targets: { "net8.0": { "Demo/1.0.0": { type: "package" } } },
        }),
      );
    }
    const inventory = vi
      .spyOn(NuGetClient, "loadInstalledReferences")
      .mockResolvedValue(
        fixture.projects.map((projectPath) => ({
          referenceId: JSON.stringify([projectPath, "net8.0", "demo", true]),
          projectPath,
          framework: "net8.0",
          packageId: "Demo",
          requestedVersion: "1.0.0",
          resolvedVersion: "1.0.0",
          direct: true,
          declarationPath: null,
          affectedProjectPaths: [],
        })),
      );
    const context = {
      targetId: "solution",
      projectPaths: fixture.projects,
      feedUrls: fixture.options.feedUrls,
      includePrerelease: false,
      revision: "selection",
    };
    const snapshot = await adapter.loadInventory(
      context,
      new AbortController().signal,
    );
    expect(inventory).toHaveBeenCalledWith(
      expect.objectContaining({ readOnly: true }),
    );
    expect(snapshot.projectRevisions[fixture.projects[0]!]).toBeTruthy();
    expect(snapshot.projectRevisions[fixture.projects[0]!]).toBe(
      snapshot.projectRevisions[fixture.projects[1]!],
    );
    expect(
      snapshot.references.every(
        (reference) => reference.affectedProjectPaths.length === 2,
      ),
    ).toBe(true);
    const candidate = {
      key: "",
      packageId: "Demo",
      projectPath: fixture.projects[0]!,
      referenceIds: snapshot.references.map(
        (reference) => reference.referenceId,
      ),
      version: "1.5.0",
      feedUrls: fixture.options.feedUrls,
      compatibility: {
        status: "unverified" as const,
        reason: "pending",
        diagnostics: [],
      },
    };
    candidate.key = candidateKey(candidate);
    await fs.appendFile(
      path.join(fixture.root, "Directory.Build.props"),
      "\n<!-- changed -->",
    );
    expect(
      await adapter.verify(
        candidate,
        snapshot,
        context,
        new AbortController().signal,
      ),
    ).toEqual({ kind: "unverified", reason: "snapshot-changed" });
  } finally {
    vi.restoreAllMocks();
    adapter.dispose();
    await fixture.dispose();
  }
});
