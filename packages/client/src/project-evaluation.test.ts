import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateProject } from "./project-evaluation";
import { contextFixture } from "./test/project-context-fixture";

describe("project evaluation", () => {
  it("identifies the full consumer scope of a central literal declaration", async () => {
    const fixture = await contextFixture(true);
    try {
      const result = await evaluateProject(fixture.cli, fixture.options);
      expect(result.isolation).toEqual({ supported: true, reasons: [] });
      expect(result.references).toHaveLength(2);
      expect(
        result.references.every(
          (reference) =>
            reference.declarationPath ===
            path.join(fixture.root, "Directory.Packages.props"),
        ),
      ).toBe(true);
      expect(
        result.references.every(
          (reference) => reference.affectedProjectPaths.length === 2,
        ),
      ).toBe(true);
      expect(
        result.references.every(
          (reference) => reference.resolvedVersion === null,
        ),
      ).toBe(true);
      expect(
        result.inputs.some(
          (input) => input.kind === "tool" && input.path === fixture.sdkInput,
        ),
      ).toBe(true);
    } finally {
      await fixture.dispose();
    }
  });

  it("changes revision for input, source and SDK changes, not enumeration order", async () => {
    const fixture = await contextFixture();
    try {
      const first = await evaluateProject(fixture.cli, fixture.options);
      expect(
        (
          await evaluateProject(fixture.cli, {
            ...fixture.options,
            feedUrls: [...fixture.options.feedUrls].reverse(),
          })
        ).contextRevision,
      ).toBe(first.contextRevision);
      expect(
        (
          await evaluateProject(fixture.cli, {
            ...fixture.options,
            sourceRevision: "r2",
          })
        ).contextRevision,
      ).not.toBe(first.contextRevision);
      await fs.writeFile(
        path.join(fixture.root, "Directory.Build.props"),
        "<Project><!-- changed --></Project>",
      );
      expect(
        (await evaluateProject(fixture.cli, fixture.options)).contextRevision,
      ).not.toBe(first.contextRevision);
    } finally {
      await fixture.dispose();
    }
  });

  it("never evaluates rejected custom targets", async () => {
    const fixture = await contextFixture();
    try {
      await fs.writeFile(
        path.join(fixture.root, "Directory.Build.targets"),
        '<Project><Target Name="Unsafe"/></Project>',
      );
      const result = await evaluateProject(fixture.cli, fixture.options);
      expect(result.isolation.supported).toBe(false);
      expect(result.isolation.reasons).toContain("custom-target");
      expect(
        fixture.runDotnet.mock.calls.every(([args]) => args[0] === "--version"),
      ).toBe(true);
    } finally {
      await fixture.dispose();
    }
  });

  it("keeps unknown version origin non-executable even in a relocatable context", async () => {
    const fixture = await contextFixture();
    try {
      await fs.writeFile(
        fixture.projects[0]!,
        '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework><DemoVersion>1.0.0</DemoVersion></PropertyGroup><ItemGroup><PackageReference Include="Demo" Version="$(DemoVersion)"/></ItemGroup></Project>',
      );
      const result = await evaluateProject(fixture.cli, fixture.options);
      expect(
        result.references.find(
          (reference) => reference.projectPath === fixture.projects[0],
        )?.declarationPath,
      ).toBeNull();
    } finally {
      await fixture.dispose();
    }
  });

  it("propagates cancellation instead of returning a successful empty evaluation", async () => {
    const fixture = await contextFixture();
    try {
      await expect(
        evaluateProject(fixture.cli, fixture.options, AbortSignal.abort()),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(fixture.runDotnet).not.toHaveBeenCalled();
    } finally {
      await fixture.dispose();
    }
  });

  it("invalidates even an unsupported snapshot when the effective SDK changes", async () => {
    const fixture = await contextFixture();
    try {
      await fs.writeFile(
        path.join(fixture.root, "Directory.Build.targets"),
        '<Project><Target Name="Unsupported"/></Project>',
      );
      const first = await evaluateProject(fixture.cli, fixture.options);
      fixture.runDotnet.mockResolvedValue({
        code: 0,
        stdout: "10.0.400",
        stderr: "",
      });
      const second = await evaluateProject(fixture.cli, fixture.options);
      expect(second.sdk.major).toBe(10);
      expect(second.contextRevision).not.toBe(first.contextRevision);
      expect(second.isolation.supported).toBe(false);
    } finally {
      await fixture.dispose();
    }
  });
});
