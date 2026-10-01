import fs from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { evaluateProject } from "./project-evaluation";
import {
  createCompatibilitySandbox,
  validateCompatibilitySandbox,
} from "./compatibility-sandbox";
import {
  checkedDotnet,
  createDotnetFixture,
  snapshotTree,
} from "./test/dotnet-fixture";

it.each(["simple", "multi", "imports", "central"] as const)(
  "evaluates and materializes the %s context using production services",
  async (layout) => {
    const fixture = await createDotnetFixture({
      sdkMajor: Number(process.env.SDK_MAJOR),
      layout,
    });
    try {
      if (layout === "simple" || layout === "multi") {
        const text = await fs.readFile(fixture.projectPath, "utf8");
        await fs.writeFile(
          fixture.projectPath,
          text.replace(
            "</Project>",
            '<ItemGroup><PackageReference Include="Demo" Version="1.0.0"/></ItemGroup></Project>',
          ),
        );
      }
      // A normal restore is setup, not part of evaluation or candidate verification.
      await checkedDotnet(
        fixture.cli,
        [
          "restore",
          fixture.projectPath,
          "--configfile",
          path.join(fixture.root, "NuGet.Config"),
        ],
        path.dirname(fixture.projectPath),
      );
      const before = await snapshotTree(fixture.root);
      const evaluated = await evaluateProject(fixture.cli, {
        projectPath: fixture.projectPath,
        allowedRoots: [fixture.root],
        restoreConfigPath: path.join(fixture.root, "NuGet.Config"),
        sourceRevision: "local",
        feedUrls: [fixture.feedPath],
      });
      expect(
        evaluated.isolation,
        evaluated.isolation.reasons.join("\n"),
      ).toEqual({ supported: true, reasons: [] });
      const references = evaluated.references.filter(
        (reference) => reference.packageId.toLowerCase() === "demo",
      );
      expect(references.length).toBeGreaterThan(0);
      expect(
        references
          .filter(
            (reference) => reference.projectPath === evaluated.projectPath,
          )
          .every((reference) => reference.resolvedVersion === "1.0.0"),
      ).toBe(true);
      expect(
        references.every((reference) => reference.declarationPath !== null),
      ).toBe(true);
      if (layout === "central")
        expect(
          references.every(
            (reference) => reference.affectedProjectPaths.length === 2,
          ),
        ).toBe(true);
      const sandbox = await createCompatibilitySandbox(evaluated);
      try {
        await validateCompatibilitySandbox(fixture.cli, evaluated, sandbox);
        expect(await snapshotTree(fixture.root)).toEqual(before);
        expect(sandbox.sourceToCopy.has(evaluated.projectPath)).toBe(true);
      } finally {
        await sandbox.dispose();
      }
      await expect(fs.stat(sandbox.root)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await fixture.dispose();
    }
  },
);

it("does not evaluate external imports or create a supported context for them", async () => {
  const fixture = await createDotnetFixture({
    sdkMajor: Number(process.env.SDK_MAJOR),
    layout: "external",
  });
  try {
    const before = await snapshotTree(fixture.root);
    const evaluated = await evaluateProject(fixture.cli, {
      projectPath: fixture.projectPath,
      allowedRoots: [fixture.root],
      restoreConfigPath: path.join(fixture.root, "NuGet.Config"),
      sourceRevision: "local",
      feedUrls: [fixture.feedPath],
    });
    expect(evaluated.isolation.supported).toBe(false);
    expect(evaluated.isolation.reasons).toContain("external-input");
    expect(evaluated.projects).toEqual([]);
    await expect(createCompatibilitySandbox(evaluated)).rejects.toMatchObject({
      code: "unsupported-context",
    });
    expect(await snapshotTree(fixture.root)).toEqual(before);
  } finally {
    await fixture.dispose();
  }
});
