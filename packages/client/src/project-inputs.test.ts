import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectProjectInputs } from "./project-inputs";
import { verifyProjectInputs } from "./project-files";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) =>
        fs.rm(root, { recursive: true, force: true, maxRetries: 5 }),
      ),
  );
});
async function fixture() {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "nuget-inputs-")),
  );
  roots.push(root);
  const projectPath = path.join(root, "App.csproj");
  for (const name of [
    "Directory.Build.props",
    "Directory.Build.targets",
    "Directory.Packages.props",
  ])
    await fs.writeFile(path.join(root, name), "<Project/>");
  await fs.writeFile(
    path.join(root, "global.json"),
    '{"sdk":{"version":"8.0.425"}}',
  );
  const restoreConfigPath = path.join(root, "NuGet.Config");
  await fs.writeFile(
    restoreConfigPath,
    "<configuration><packageSources><clear/></packageSources></configuration>",
  );
  await fs.writeFile(
    projectPath,
    '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>',
  );
  return {
    root,
    projectPath,
    options: {
      projectPath,
      allowedRoots: [root],
      feedUrls: [],
      sourceRevision: "sources",
      restoreConfigPath,
    },
  };
}

describe("authorized project inputs", () => {
  it("captures literal imports, all workspace projects and missing generated inputs", async () => {
    const { root, projectPath, options } = await fixture();
    await fs.writeFile(
      path.join(root, "Shared.props"),
      '<Project><ItemGroup><PackageReference Include="Demo" Version="1.0.0"/></ItemGroup></Project>',
    );
    await fs.writeFile(
      projectPath,
      '<Project Sdk="Microsoft.NET.Sdk"><Import Project="Shared.props"/><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>',
    );
    const other = path.join(root, "Other.csproj");
    await fs.copyFile(projectPath, other);
    const collected = await collectProjectInputs(options);
    expect(collected.reasons).toEqual([]);
    expect(collected.projectPaths).toEqual([projectPath, other].sort());
    expect(collected.inputs).toContainEqual(
      expect.objectContaining({
        path: path.join(root, "Shared.props"),
        hash: expect.any(String),
        copy: true,
      }),
    );
    expect(collected.inputs).toContainEqual(
      expect.objectContaining({
        path: path.join(root, "obj", "App.csproj.nuget.g.props"),
        hash: null,
      }),
    );
    await verifyProjectInputs(collected.inputs, collected.directories);
    await fs.writeFile(path.join(root, "Shared.props"), "<Project />");
    await expect(
      verifyProjectInputs(collected.inputs, collected.directories),
    ).rejects.toMatchObject({ code: "stale-input" });
  });

  it("does not read an external import, even if its XML is malformed", async () => {
    const { root, projectPath, options } = await fixture();
    const external = await fs.mkdtemp(path.join(os.tmpdir(), "nuget-outside-"));
    roots.push(external);
    const externalFile = path.join(external, "outside.props");
    await fs.writeFile(externalFile, "not XML");
    await fs.writeFile(
      projectPath,
      `<Project Sdk="Microsoft.NET.Sdk"><Import Project="${externalFile}"/></Project>`,
    );
    const collected = await collectProjectInputs(options);
    expect(collected.reasons).toContain("external-input");
    expect(collected.inputs.some((input) => input.path === externalFile)).toBe(
      false,
    );
    expect(collected.root).toBe(await fs.realpath(root));
  });

  it("records missing imports and invalidates the snapshot when they appear", async () => {
    const { root, projectPath, options } = await fixture();
    await fs.writeFile(
      projectPath,
      '<Project Sdk="Microsoft.NET.Sdk"><Import Project="optional.props" Condition="Exists(\'optional.props\')"/></Project>',
    );
    const collected = await collectProjectInputs(options);
    expect(collected.inputs).toContainEqual(
      expect.objectContaining({
        path: path.join(root, "optional.props"),
        hash: null,
      }),
    );
    await fs.writeFile(path.join(root, "optional.props"), "<Project/>");
    await expect(
      verifyProjectInputs(collected.inputs, collected.directories),
    ).rejects.toMatchObject({ code: "stale-input" });
  });

  it("does not silently assume missing ancestor boundaries are empty", async () => {
    const { root, options } = await fixture();
    await fs.rm(path.join(root, "Directory.Build.targets"));
    expect((await collectProjectInputs(options)).reasons).toContain(
      "ancestor-context-unverified:Directory.Build.targets",
    );
  });

  it("requires an explicit restore configuration", async () => {
    const { options } = await fixture();
    const withoutConfig = {
      projectPath: options.projectPath,
      allowedRoots: options.allowedRoots,
      feedUrls: options.feedUrls,
      sourceRevision: options.sourceRevision,
    };
    expect((await collectProjectInputs(withoutConfig)).reasons).toContain(
      "restore-config-required",
    );
  });

  it("refuses dynamic evaluation and observes newly discovered consumers", async () => {
    const { root, projectPath, options } = await fixture();
    const before = await collectProjectInputs(options);
    await fs.writeFile(
      path.join(root, "New.csproj"),
      '<Project Sdk="Microsoft.NET.Sdk"/>',
    );
    await expect(
      verifyProjectInputs(before.inputs, before.directories),
    ).rejects.toMatchObject({ code: "stale-input" });
    await fs.writeFile(
      projectPath,
      "<Project Sdk=\"Microsoft.NET.Sdk\"><PropertyGroup><X>&#36;([System.IO.File]::ReadAllText('outside'))</X></PropertyGroup></Project>",
    );
    expect((await collectProjectInputs(options)).reasons).toContain(
      "property-function",
    );
  });

  it("does not collapse distinct project paths on a case-sensitive filesystem", async () => {
    const { root, options } = await fixture();
    const lower = path.join(root, "case.csproj");
    const upper = path.join(root, "CASE.csproj");
    await fs.writeFile(lower, '<Project Sdk="Microsoft.NET.Sdk"/>');
    await fs.writeFile(upper, '<Project Sdk="Microsoft.NET.Sdk"/>');
    const collected = await collectProjectInputs(options);
    expect(
      collected.projectPaths.filter(
        (file) => path.basename(file).toLowerCase() === "case.csproj",
      ),
    ).toHaveLength(process.platform === "win32" ? 1 : 2);
  });

  it("refuses a linked directory instead of discovering consumers outside the root", async () => {
    const { root, options } = await fixture();
    const external = await fs.mkdtemp(path.join(os.tmpdir(), "nuget-linked-"));
    roots.push(external);
    await fs.writeFile(path.join(external, "Outside.csproj"), "<Project/>");
    await fs.symlink(
      external,
      path.join(root, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const collected = await collectProjectInputs(options);
    expect(collected.reasons).toContain("linked-input");
    expect(
      collected.projectPaths.some((project) => project.includes("Outside")),
    ).toBe(false);
  });
});
