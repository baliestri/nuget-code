import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";
import type { NuGetCli } from "#client/cli";

export async function contextFixture(central = false) {
  const home = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "nuget-context-")),
  );
  const root = path.join(home, "workspace");
  const tool = path.join(home, "sdk", "8.0.425");
  await fs.mkdir(root);
  await fs.mkdir(tool, { recursive: true });
  const sdkInput = path.join(tool, "Sdk.props");
  await fs.writeFile(sdkInput, "<Project/>");
  for (const name of ["Directory.Build.props", "Directory.Build.targets"])
    await fs.writeFile(path.join(root, name), "<Project/>");
  await fs.writeFile(
    path.join(root, "Directory.Packages.props"),
    central
      ? '<Project><PropertyGroup><ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally></PropertyGroup><ItemGroup><PackageVersion Include="Demo" Version="1.0.0"/></ItemGroup></Project>'
      : "<Project/>",
  );
  await fs.writeFile(
    path.join(root, "global.json"),
    '{"sdk":{"version":"8.0.425"}}',
  );
  const restoreConfigPath = path.join(root, "NuGet.Config");
  await fs.writeFile(
    restoreConfigPath,
    '<configuration><packageSources><clear/><add key="local" value="feed"/></packageSources><config><add key="globalPackagesFolder" value="packages"/></config></configuration>',
  );
  const projects = [path.join(root, "A.csproj"), path.join(root, "B.csproj")];
  for (const project of projects)
    await fs.writeFile(
      project,
      `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup><PackageReference Include="Demo"${central ? "" : ' Version="1.0.0"'}/></ItemGroup></Project>`,
    );
  const runDotnet = vi.fn(
    async (
      args: string[],
      _cwd?: string,
      options?: { signal?: AbortSignal },
    ) => {
      options?.signal?.throwIfAborted();
      if (args[0] === "--version")
        return { code: 0, stdout: "8.0.425", stderr: "" };
      const project = args[1]!;
      const directory = path.dirname(project);
      if (args.some((arg) => arg.startsWith("-preprocess:"))) {
        const output = args
          .find((arg) => arg.startsWith("-preprocess:"))!
          .slice("-preprocess:".length);
        await fs.writeFile(
          output,
          [
            project,
            sdkInput,
            ...[
              "Directory.Build.props",
              "Directory.Build.targets",
              "Directory.Packages.props",
            ].map((name) => path.join(directory, name)),
          ].join("\n"),
        );
        return { code: 0, stdout: "", stderr: "" };
      }
      return {
        code: 0,
        stderr: "",
        stdout: JSON.stringify({
          Properties: {
            TargetFramework: "net8.0",
            TargetFrameworks: "",
            TargetFrameworkMoniker: ".NETCoreApp,Version=v8.0",
            MSBuildProjectDirectory: directory,
            MSBuildToolsPath: tool,
            ManagePackageVersionsCentrally: String(central),
          },
          Items: {
            PackageReference: [
              {
                Identity: "Demo",
                ...(central ? {} : { Version: "1.0.0" }),
                DefiningProjectFullPath: project,
              },
            ],
            PackageVersion: central
              ? [
                  {
                    Identity: "Demo",
                    Version: "1.0.0",
                    DefiningProjectFullPath: path.join(
                      directory,
                      "Directory.Packages.props",
                    ),
                  },
                ]
              : [],
            ProjectReference: [],
            FrameworkReference: [],
          },
        }),
      };
    },
  );
  return {
    home,
    root,
    tool,
    sdkInput,
    projects,
    cli: { runDotnet } as unknown as NuGetCli,
    runDotnet,
    options: {
      projectPath: projects[0]!,
      allowedRoots: [root],
      feedUrls: [path.join(root, "feed")],
      sourceRevision: "r1",
      restoreConfigPath,
    },
    dispose: () => fs.rm(home, { recursive: true, force: true, maxRetries: 5 }),
  };
}
