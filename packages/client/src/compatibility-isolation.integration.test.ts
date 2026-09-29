import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { dotnetArguments } from "./dotnet-sdk";
import { expect, it } from "vitest";
import {
  checkedDotnet,
  createDotnetFixture,
  snapshotTree,
  type DotnetFixture,
} from "./test/dotnet-fixture";
import {
  inspectFixtureProject,
  probeFixture,
  type ProbeResult,
} from "./test/isolation-probe";

// Feasibility experiment only. No production consumer may import this prototype.
const major = Number(process.env.SDK_MAJOR);

it("observes native update scope for an imported reference in a disposable copy", async () => {
  const fixture = await createDotnetFixture({
    sdkMajor: major,
    layout: "imports",
  });
  const copy = await fs.mkdtemp(path.join(os.tmpdir(), "nuget-native-scope-"));
  try {
    const before = await snapshotTree(fixture.root);
    await fs.cp(fixture.root, copy, { recursive: true });
    const config = path.join(copy, "NuGet.Config");
    await fs.writeFile(
      config,
      (await fs.readFile(config, "utf8")).split(fixture.root).join(copy),
    );
    const project = path.join(
      copy,
      path.relative(fixture.root, fixture.projectPath),
    );
    const shared = path.join(copy, "Shared.props");
    const projectBefore = await fs.readFile(project, "utf8");
    const sharedBefore = await fs.readFile(shared, "utf8");
    const result = await fixture.cli.runDotnet(
      dotnetArguments(
        { major, version: fixture.sdkVersion, cwd: path.dirname(project) },
        {
          kind: "add",
          projectPath: project,
          packageId: "Demo",
          version: "1.5.0",
        },
      ),
      path.dirname(project),
      { signal: AbortSignal.timeout(60_000) },
    );
    expect(result.code).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(
      /cannot edit items in imported files/i,
    );
    expect(await fs.readFile(project, "utf8")).toBe(projectBefore);
    expect(await fs.readFile(shared, "utf8")).toBe(sharedBefore);
    console.info(
      JSON.stringify({
        sdk: fixture.sdkVersion,
        nativeExit: result.code,
        diagnostic: "cannot-edit-imported-reference",
        changedProject: false,
        changedSharedProps: false,
      }),
    );
    expect(await snapshotTree(fixture.root)).toEqual(before);
  } finally {
    await fixture.dispose();
    await fs.rm(copy, { recursive: true, force: true, maxRetries: 5 });
  }
});

it("observes evaluated reference origins and preprocessed imports without changing the fixture", async () => {
  const fixture = await createDotnetFixture({
    sdkMajor: major,
    layout: "imports",
  });
  const scratch = await fs.mkdtemp(
    path.join(os.tmpdir(), "nuget-isolation-inspect-"),
  );
  try {
    const before = await snapshotTree(fixture.root);
    const evaluated = await checkedDotnet(
      fixture.cli,
      [
        "msbuild",
        fixture.projectPath,
        "-nologo",
        "-getProperty:TargetFramework,TargetFrameworks,MSBuildAllProjects,ManagePackageVersionsCentrally,MSBuildProjectDirectory,MSBuildSDKsPath,RestorePackagesPath,RestoreLockedMode,MSBuildProjectExtensionsPath",
        "-getItem:PackageReference,PackageVersion,ProjectReference",
      ],
      path.dirname(fixture.projectPath),
    );
    const data = JSON.parse(evaluated.stdout) as {
      Properties: Record<string, string>;
      Items: Record<string, Record<string, string>[]>;
    };
    expect(data.Items.PackageReference?.[0]?.DefiningProjectFullPath).toMatch(
      /Shared\.props$/,
    );
    const output = path.join(scratch, "project.xml");
    await checkedDotnet(
      fixture.cli,
      ["msbuild", fixture.projectPath, "-nologo", `-preprocess:${output}`],
      path.dirname(fixture.projectPath),
    );
    const preprocessed = await fs.readFile(output, "utf8");
    expect(preprocessed).toContain("Shared.props");
    console.info(
      JSON.stringify({
        sdk: fixture.sdkVersion,
        allProjectsIncludesShared:
          data.Properties.MSBuildAllProjects?.includes("Shared.props"),
        referenceOriginIncludesShared: true,
        preprocessedIncludesShared: true,
      }),
    );
    expect(await snapshotTree(fixture.root)).toEqual(before);
  } finally {
    await fixture.dispose();
    await fs.rm(scratch, { recursive: true, force: true, maxRetries: 5 });
  }
});

async function addDirectReference(fixture: DotnetFixture): Promise<void> {
  const project = await fs.readFile(fixture.projectPath, "utf8");
  await fs.writeFile(
    fixture.projectPath,
    project.replace(
      "</Project>",
      '<ItemGroup><PackageReference Include="Demo" Version="1.0.0"/></ItemGroup></Project>',
    ),
  );
}

it("reproduces a standard web SDK project as well as a library", async () => {
  const fixture = await createDotnetFixture({
    sdkMajor: major,
    layout: "simple",
  });
  try {
    const project = await fs.readFile(fixture.projectPath, "utf8");
    await fs.writeFile(
      fixture.projectPath,
      project.replace('Sdk="Microsoft.NET.Sdk"', 'Sdk="Microsoft.NET.Sdk.Web"'),
    );
    await addDirectReference(fixture);
    const result = await unchanged(fixture, () =>
      probeFixture(fixture, "1.5.0"),
    );
    expect(result.status, result.diagnostics.join("\n")).toBe("compatible");
  } finally {
    await fixture.dispose();
  }
});

async function unchanged(
  fixture: DotnetFixture,
  action: () => Promise<ProbeResult>,
): Promise<ProbeResult> {
  const before = await snapshotTree(fixture.root);
  const result = await action();
  expect(await snapshotTree(fixture.root)).toEqual(before);
  expect(result.sandboxRemoved).toBe(true);
  if (result.sandboxRoot)
    await expect(fs.stat(result.sandboxRoot)).rejects.toMatchObject({
      code: "ENOENT",
    });
  console.info(
    JSON.stringify({
      status: result.status,
      diagnostics: result.diagnostics,
      projects: result.affectedProjects,
      frameworks: result.frameworks,
      originalsUnchanged: true,
      sandboxRemoved: true,
    }),
  );
  return result;
}

it.each(["simple", "multi", "imports", "central"] as const)(
  "proves a relocated %s fixture without modifying original inputs or outputs",
  async (layout) => {
    const fixture = await createDotnetFixture({ sdkMajor: major, layout });
    try {
      if (layout === "simple" || layout === "multi")
        await addDirectReference(fixture);
      const result = await unchanged(fixture, () =>
        probeFixture(fixture, "1.5.0"),
      );
      expect(result.status, result.diagnostics.join("\n")).toBe("compatible");
      expect(result.frameworks).toHaveLength(
        layout === "multi" || layout === "central" ? 2 : 1,
      );
      if (layout === "central") expect(result.affectedProjects).toHaveLength(2);
      if (layout === "imports")
        expect(result.importedInputs).toContain("Shared.props");
    } finally {
      await fixture.dispose();
    }
  },
);

it("returns unverified before copying an import outside the allowed fixture", async () => {
  const fixture = await createDotnetFixture({
    sdkMajor: major,
    layout: "external",
  });
  try {
    const result = await unchanged(fixture, () =>
      probeFixture(fixture, "1.5.0"),
    );
    expect(result).toMatchObject({
      status: "unverified",
      diagnostics: ["unverified:external-input"],
      sandboxRoot: null,
    });
  } finally {
    await fixture.dispose();
  }
});

it("detects a condition whose meaning changes when the project moves", async () => {
  const fixture = await createDotnetFixture({
    sdkMajor: major,
    layout: "simple",
  });
  const scratch = await fs.mkdtemp(
    path.join(os.tmpdir(), "nuget-probe-condition-"),
  );
  try {
    const model = await inspectFixtureProject(
      fixture,
      await fs.realpath(fixture.projectPath),
      scratch,
    );
    const originalDirectory =
      model.frames[0]!.evaluation.Properties.MSBuildProjectDirectory!;
    const escaped = originalDirectory
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;");
    const project = await fs.readFile(fixture.projectPath, "utf8");
    await fs.writeFile(
      fixture.projectPath,
      project.replace(
        "</Project>",
        `<ItemGroup Condition="'$(MSBuildProjectDirectory)' == '${escaped}'"><PackageReference Include="Demo" Version="1.0.0"/></ItemGroup></Project>`,
      ),
    );
    const result = await unchanged(fixture, () =>
      probeFixture(fixture, "1.5.0"),
    );
    expect(result).toMatchObject({
      status: "unverified",
      diagnostics: ["unverified:evaluation-changed"],
    });
  } finally {
    await fixture.dispose();
    await fs.rm(scratch, { recursive: true, force: true });
  }
});

it("preserves project references, Directory.Build inputs and package source mapping", async () => {
  const fixture = await createDotnetFixture({
    sdkMajor: major,
    layout: "simple",
  });
  try {
    await addDirectReference(fixture);
    const library = path.join(fixture.root, "Library");
    await fs.mkdir(library);
    await fs.writeFile(
      path.join(library, "Library.csproj"),
      `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net${major}.0</TargetFramework><NuGetAudit>false</NuGetAudit></PropertyGroup></Project>`,
    );
    const project = await fs.readFile(fixture.projectPath, "utf8");
    await fs.writeFile(
      fixture.projectPath,
      project.replace(
        "</Project>",
        '<ItemGroup><ProjectReference Include="../Library/Library.csproj"/></ItemGroup></Project>',
      ),
    );
    await fs.writeFile(
      path.join(fixture.root, "Directory.Build.props"),
      "<Project><PropertyGroup><Nullable>enable</Nullable></PropertyGroup></Project>",
    );
    const config = path.join(fixture.root, "NuGet.Config");
    await fs.writeFile(
      config,
      (await fs.readFile(config, "utf8")).replace(
        "</configuration>",
        '<packageSourceMapping><packageSource key="local"><package pattern="Demo"/></packageSource></packageSourceMapping></configuration>',
      ),
    );
    const result = await unchanged(fixture, () =>
      probeFixture(fixture, "1.5.0"),
    );
    expect(result.status, result.diagnostics.join("\n")).toBe("compatible");
    expect(result.importedInputs).toContain("Library/Library.csproj");
    expect(result.importedInputs).toContain("Directory.Build.props");
    expect(result.importedInputs).toContain("Directory.Build.targets");
  } finally {
    await fixture.dispose();
  }
});

it.each([false, true])(
  "preserves original assets and lockfile with locked mode %s",
  async (locked) => {
    const fixture = await createDotnetFixture({
      sdkMajor: major,
      layout: "simple",
    });
    try {
      await addDirectReference(fixture);
      await checkedDotnet(
        fixture.cli,
        [
          "restore",
          fixture.projectPath,
          "--use-lock-file",
          "--configfile",
          path.join(fixture.root, "NuGet.Config"),
        ],
        path.dirname(fixture.projectPath),
      );
      if (locked) {
        const text = await fs.readFile(fixture.projectPath, "utf8");
        await fs.writeFile(
          fixture.projectPath,
          text.replace(
            "</Project>",
            "<PropertyGroup><RestoreLockedMode>true</RestoreLockedMode></PropertyGroup></Project>",
          ),
        );
      }
      const result = await unchanged(fixture, () =>
        probeFixture(fixture, "1.5.0"),
      );
      expect(result.status, result.diagnostics.join("\n")).toBe(
        locked ? "unverified" : "compatible",
      );
      if (locked) expect(result.diagnostics).toContain("NU1004");
    } finally {
      await fixture.dispose();
    }
  },
);

async function packCandidate(
  fixture: DotnetFixture,
  version: string,
  extra = "",
): Promise<void> {
  const producer = path.join(fixture.root, "producer", "Demo.csproj");
  await fs.writeFile(
    producer,
    `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net${major}.0</TargetFramework><NuGetAudit>false</NuGetAudit><UseSharedCompilation>false</UseSharedCompilation></PropertyGroup>${extra}</Project>`,
  );
  await checkedDotnet(
    fixture.cli,
    [
      "pack",
      producer,
      "--output",
      fixture.feedPath,
      `-p:PackageVersion=${version}`,
      "--verbosity",
      "quiet",
    ],
    path.dirname(producer),
  );
}

it("rejects a candidate incompatible with one of the target frameworks", async () => {
  const fixture = await createDotnetFixture({
    sdkMajor: major,
    layout: "multi",
  });
  try {
    await addDirectReference(fixture);
    await packCandidate(fixture, "9.0.0");
    const result = await unchanged(fixture, () =>
      probeFixture(fixture, "9.0.0"),
    );
    expect(result.status, result.diagnostics.join("\n")).toBe("incompatible");
    expect(result.diagnostics).toContain("NU1202");
  } finally {
    await fixture.dispose();
  }
});

it("checks the other consumer of a changed central version", async () => {
  const fixture = await createDotnetFixture({
    sdkMajor: major,
    layout: "central",
  });
  try {
    const other = path.join(fixture.root, "Other", "Other.csproj");
    await fs.writeFile(
      other,
      (await fs.readFile(other, "utf8")).replace(
        `net${major}.0`,
        "netstandard2.1",
      ),
    );
    await packCandidate(fixture, "9.0.0");
    const result = await unchanged(fixture, () =>
      probeFixture(fixture, "9.0.0"),
    );
    expect(result.affectedProjects).toHaveLength(2);
    expect(result.status, result.diagnostics.join("\n")).toBe("incompatible");
    expect(result.diagnostics).toContain("NU1202");
  } finally {
    await fixture.dispose();
  }
});

it("reports a missing candidate as unverified, not framework incompatibility", async () => {
  const fixture = await createDotnetFixture({
    sdkMajor: major,
    layout: "simple",
  });
  try {
    await addDirectReference(fixture);
    const result = await unchanged(fixture, () =>
      probeFixture(fixture, "999.0.0"),
    );
    expect(result.status).toBe("unverified");
    expect(result.diagnostics).toContain("NU1102");
  } finally {
    await fixture.dispose();
  }
});

it("cleans a cancelled restore without changing the original fixture", async () => {
  const fixture = await createDotnetFixture({
    sdkMajor: major,
    layout: "simple",
  });
  try {
    await addDirectReference(fixture);
    const controller = new AbortController();
    const result = await unchanged(fixture, () =>
      probeFixture(fixture, "1.5.0", {
        signal: controller.signal,
        onRestoreStarted: () => controller.abort(),
      }),
    );
    expect(result).toMatchObject({
      status: "unverified",
      diagnostics: ["cancelled"],
    });
  } finally {
    await fixture.dispose();
  }
});

it("refuses custom targets before they can write outside the copy", async () => {
  const fixture = await createDotnetFixture({
    sdkMajor: major,
    layout: "simple",
  });
  try {
    await addDirectReference(fixture);
    const marker = path.join(fixture.root, "must-not-exist.txt");
    const targets = `<Project><Target Name="UnexpectedWrite" BeforeTargets="Restore"><WriteLinesToFile File="${marker.replaceAll("&", "&amp;")}" Lines="changed"/></Target></Project>`;
    await fs.writeFile(
      path.join(fixture.root, "Directory.Build.targets"),
      targets,
    );
    const result = await unchanged(fixture, () =>
      probeFixture(fixture, "1.5.0"),
    );
    expect(result).toMatchObject({
      status: "unverified",
      diagnostics: ["unverified:custom-target"],
      sandboxRoot: null,
    });
    await expect(fs.stat(marker)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await fixture.dispose();
  }
});

it("refuses package build imports rather than trusting a temporary directory alone", async () => {
  const fixture = await createDotnetFixture({
    sdkMajor: major,
    layout: "simple",
  });
  try {
    await addDirectReference(fixture);
    await fs.writeFile(
      path.join(fixture.root, "producer", "Demo.targets"),
      '<Project><Target Name="Custom" BeforeTargets="Restore"/></Project>',
    );
    await packCandidate(
      fixture,
      "9.0.0",
      '<ItemGroup><None Include="Demo.targets" Pack="true" PackagePath="build/"/></ItemGroup>',
    );
    const result = await unchanged(fixture, () =>
      probeFixture(fixture, "9.0.0"),
    );
    expect(result).toMatchObject({
      status: "unverified",
      diagnostics: ["unverified:package-build-import"],
      sandboxRoot: null,
    });
  } finally {
    await fixture.dispose();
  }
});

it("refuses decoded property functions before evaluating them", async () => {
  const fixture = await createDotnetFixture({
    sdkMajor: major,
    layout: "simple",
  });
  try {
    await addDirectReference(fixture);
    const marker = path.join(fixture.root, "must-not-exist.txt");
    const project = await fs.readFile(fixture.projectPath, "utf8");
    await fs.writeFile(
      fixture.projectPath,
      project.replace(
        "</Project>",
        `<PropertyGroup><Unsafe>&#36;([System.IO.File]::WriteAllText('${marker}', 'changed'))</Unsafe></PropertyGroup></Project>`,
      ),
    );
    const result = await unchanged(fixture, () =>
      probeFixture(fixture, "1.5.0"),
    );
    expect(result).toMatchObject({
      status: "unverified",
      diagnostics: ["unverified:property-function"],
      sandboxRoot: null,
    });
    await expect(fs.stat(marker)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await fixture.dispose();
  }
});

it("refuses output paths that escape the relocated copy", async () => {
  const fixture = await createDotnetFixture({
    sdkMajor: major,
    layout: "simple",
  });
  try {
    await addDirectReference(fixture);
    const relative = `../../${path.basename(fixture.root)}/App &amp; Tests/obj/`;
    const project = await fs.readFile(fixture.projectPath, "utf8");
    await fs.writeFile(
      fixture.projectPath,
      project.replace(
        "</Project>",
        `<PropertyGroup><BaseIntermediateOutputPath>${relative}</BaseIntermediateOutputPath></PropertyGroup></Project>`,
      ),
    );
    const result = await unchanged(fixture, () =>
      probeFixture(fixture, "1.5.0"),
    );
    expect(result).toMatchObject({
      status: "unverified",
      diagnostics: ["unverified:external-output"],
    });
  } finally {
    await fixture.dispose();
  }
});
