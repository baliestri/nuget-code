import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { contextFixture } from "#client/test/project-context-fixture";
import { NuGetClient } from "#client";
import type { MutationPlan } from "#contracts";
import { prepareExplicitUpdate } from "./explicit-package-update";
import type { DataEnvironment } from "./package-data-adapter";
import type { EditorPort } from "./version-edit-io";

afterEach(() => vi.restoreAllMocks());
const logger = { verbose() {}, information() {}, warning() {}, error() {} };
async function setup(central = false) {
  const fixture = await contextFixture(central);
  await fs.unlink(path.join(fixture.root, "Directory.Build.targets"));
  const extra = path.join(fixture.root, "Extra.Config");
  await fs.writeFile(extra, "<configuration/>");
  const environment: DataEnvironment = {
    cli: fixture.cli,
    allowedRoots: [fixture.root],
    configPaths: [fixture.options.restoreConfigPath, extra],
    sourceRevision: "r",
    target: {
      id: "target",
      kind: "solution",
      path: path.join(fixture.root, "App.sln"),
      name: "App",
      projectPaths: fixture.projects,
    },
    feeds: [
      {
        id: "feed",
        name: "Feed",
        url: fixture.options.feedUrls[0]!,
        enabled: true,
      },
    ],
    settings: {
      dotnetPath: "dotnet",
      nugetPath: "nuget",
      proxy: "",
      maxSearchResults: 100,
      extraConfigPaths: [],
      credentialProviderPaths: [],
    },
  };
  const plan: MutationPlan = {
    id: "update",
    targetId: "target",
    contextRevision: "old",
    steps: [
      {
        id: "0",
        kind: "package",
        action: "update",
        packageId: "Demo",
        version: "1.5.0",
        projectPaths: [fixture.projects[0]!],
        feedUrls: fixture.options.feedUrls,
      },
    ],
  };
  const editor: EditorPort = {
    open: async (file) => {
      let text = await fs.readFile(file, "utf8");
      return {
        text: () => text,
        version: () => 1,
        dirty: () => false,
        edit: async (_, replacement) => {
          text = replacement;
          return true;
        },
        save: async () => {
          await fs.writeFile(file, text);
          return true;
        },
      };
    },
  };
  return {
    ...fixture,
    environment,
    plan,
    editor,
    prepare: (clean: (paths: readonly string[]) => void = () => {}) =>
      prepareExplicitUpdate(
        plan,
        environment,
        [fixture.projects[0]!],
        new AbortController().signal,
        clean,
        logger,
        editor,
      ),
  };
}
it("expands an explicit central update to every shared consumer without requiring an isolatable context", async () => {
  const fixture = await setup(true);
  try {
    const prepared = await fixture.prepare();
    expect(prepared?.plan.steps).toHaveLength(1);
    expect(prepared!.plan.steps[0]!.projectPaths).toEqual(fixture.projects);
    expect(
      await fs.readFile(
        path.join(fixture.root, "Directory.Packages.props"),
        "utf8",
      ),
    ).toContain('Version="1.0.0"');
  } finally {
    await fixture.dispose();
  }
});
it("rejects dirty documents and concurrent source or declaration changes before writing", async () => {
  const fixture = await setup();
  try {
    await expect(
      fixture.prepare(() => {
        throw new Error("Save documents first");
      }),
    ).rejects.toThrow("Save documents");
    const prepared = (await fixture.prepare())!;
    await fs.appendFile(fixture.options.restoreConfigPath, "<!-- changed -->");
    await expect(prepared.execute(prepared.plan.steps[0]!)).rejects.toThrow(
      "changed",
    );
    expect(await fs.readFile(fixture.projects[0]!, "utf8")).toContain(
      'Version="1.0.0"',
    );
    const refreshed = (await fixture.prepare())!;
    await fs.appendFile(fixture.projects[0]!, "<!-- changed -->");
    await expect(refreshed.execute(refreshed.plan.steps[0]!)).rejects.toThrow(
      "changed",
    );
  } finally {
    await fixture.dispose();
  }
});
it("reports restore failures, retains the actual edit and exposes diagnostic codes without private output", async () => {
  const fixture = await setup();
  try {
    const original = fixture.runDotnet.getMockImplementation()!;
    fixture.runDotnet.mockImplementation(async (args, cwd, options) =>
      args[0] === "restore"
        ? {
            code: 1,
            stdout: "error NU1202: incompatible private-url?token=secret",
            stderr: "",
          }
        : original(args, cwd, options),
    );
    const prepared = (await fixture.prepare())!;
    const error = await prepared
      .execute(prepared.plan.steps[0]!)
      .catch((error: Error) => error);
    expect(error).toMatchObject({
      changedPaths: [fixture.projects[0]],
      projects: [{ projectPath: fixture.projects[0], status: "failed" }],
    });
    expect(String(error)).toContain("NU1202");
    expect(String(error)).not.toContain("secret");
    expect(await fs.readFile(fixture.projects[0]!, "utf8")).toContain(
      'Version="1.5.0"',
    );
  } finally {
    await fixture.dispose();
  }
});
it("checks restored inventory and honours cancellation before editing", async () => {
  const fixture = await setup();
  try {
    const prepared = (await fixture.prepare())!;
    await expect(
      prepared.execute(prepared.plan.steps[0]!, () => true),
    ).rejects.toMatchObject({ name: "AbortError", changedPaths: [] });
    expect(await fs.readFile(fixture.projects[0]!, "utf8")).toContain(
      'Version="1.0.0"',
    );
    vi.spyOn(NuGetClient, "loadInstalledReferences").mockResolvedValue([]);
    await expect(prepared.execute(prepared.plan.steps[0]!)).rejects.toThrow(
      "inventory does not match",
    );
  } finally {
    await fixture.dispose();
  }
});
