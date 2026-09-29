import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NuGetCli, type CommandResult } from "#client/cli";
import { compareNuGetVersions } from "#manager";

export interface DotnetFixture {
  root: string;
  projectPath: string;
  feedPath: string;
  sdkVersion: string;
  cli: NuGetCli;
  dispose(): Promise<void>;
}

export function fixtureCli(workspacePath: string): NuGetCli {
  return new NuGetCli(
    {
      dotnetPath: process.env.DOTNET_TEST_PATH ?? "dotnet",
      nugetPath: "nuget",
      workspacePath,
      credentialProviderPaths: [],
      extraConfigPaths: [],
      proxy: "",
      maxSearchResults: 100,
    },
    { error() {}, warning() {}, information() {}, verbose() {} },
  );
}

export async function checkedDotnet(
  cli: NuGetCli,
  args: string[],
  cwd: string,
): Promise<CommandResult> {
  const result = await cli.runDotnet(args, cwd, {
    signal: AbortSignal.timeout(120_000),
  });
  if (result.code !== 0) {
    throw new Error(
      `dotnet ${args.join(" ")} failed (${result.code}):\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result;
}

export async function selectInstalledSdk(
  cli: NuGetCli,
  cwd: string,
  major: number,
): Promise<string> {
  const result = await checkedDotnet(cli, ["--list-sdks"], cwd);
  const versions = result.stdout
    .split(/\r?\n/)
    .map((line) => /^([0-9]+\.[0-9]+\.[0-9]+)\s+\[/.exec(line)?.[1])
    .filter((version): version is string =>
      Boolean(version?.startsWith(`${major}.`)),
    )
    .sort(compareNuGetVersions);
  const selected = process.env.SDK_VERSION ?? versions.at(-1);
  if (!selected || !versions.includes(selected)) {
    throw new Error(
      `Required SDK ${process.env.SDK_VERSION ?? major} is not installed. Integration tests cannot be skipped.`,
    );
  }
  return selected;
}

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export async function createDotnetFixture(options: {
  sdkMajor: number;
  layout: "simple" | "multi" | "central" | "imports" | "external";
}): Promise<DotnetFixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nuget-sdk-"));
  const externalRoots: string[] = [];
  const dispose = async () => {
    for (const directory of [...externalRoots, root]) {
      await fs.rm(directory, { recursive: true, force: true, maxRetries: 5 });
    }
  };
  try {
    const cli = fixtureCli(root);
    const sdkVersion = await selectInstalledSdk(cli, root, options.sdkMajor);
    await fs.writeFile(
      path.join(root, "global.json"),
      JSON.stringify({
        sdk: {
          version: sdkVersion,
          rollForward: "disable",
          allowPrerelease: false,
        },
      }),
    );
    const feedPath = path.join(root, "feed");
    await fs.mkdir(feedPath);
    await fs.writeFile(
      path.join(root, "NuGet.Config"),
      `<configuration>
  <packageSources><clear/><add key="local" value="${xml(feedPath)}"/></packageSources>
  <config><add key="globalPackagesFolder" value="${xml(path.join(root, "packages"))}"/></config>
</configuration>`,
    );

    const producer = path.join(root, "producer");
    await fs.mkdir(producer);
    const packageProject = path.join(producer, "Demo.csproj");
    await fs.writeFile(
      packageProject,
      `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>
  <TargetFramework>netstandard2.1</TargetFramework><NuGetAudit>false</NuGetAudit>
  <UseSharedCompilation>false</UseSharedCompilation>
</PropertyGroup></Project>`,
    );
    await fs.writeFile(
      path.join(producer, "Marker.cs"),
      "public class Marker {}\n",
    );
    for (const version of ["1.0.0", "1.5.0", "2.0.0-beta"]) {
      await checkedDotnet(
        cli,
        [
          "pack",
          packageProject,
          "--output",
          feedPath,
          `-p:PackageVersion=${version}`,
          "--verbosity",
          "quiet",
        ],
        producer,
      );
    }

    const appDirectory = path.join(root, "App & Tests");
    await fs.mkdir(appDirectory);
    const projectPath = path.join(appDirectory, "App.csproj");
    const tfm = `net${options.sdkMajor}.0`;
    let references = "";
    if (options.layout === "central") {
      await fs.writeFile(
        path.join(root, "Directory.Packages.props"),
        `<Project>
  <PropertyGroup><ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally></PropertyGroup>
  <ItemGroup><PackageVersion Include="Demo" Version="1.0.0"/></ItemGroup>
</Project>`,
      );
      references = '<ItemGroup><PackageReference Include="Demo"/></ItemGroup>';
    } else if (options.layout === "imports" || options.layout === "external") {
      let imported = path.join(root, "Shared.props");
      if (options.layout === "external") {
        const external = await fs.mkdtemp(
          path.join(os.tmpdir(), "nuget-sdk-external-"),
        );
        externalRoots.push(external);
        imported = path.join(external, "Shared.props");
      }
      await fs.writeFile(
        imported,
        `<Project><ItemGroup Condition="'$(TargetFramework)' == '${tfm}'">
  <PackageReference Include="Demo" Version="1.0.0"/>
</ItemGroup></Project>`,
      );
      references = `<Import Project="${xml(options.layout === "imports" ? "../Shared.props" : imported)}"/>`;
    }
    const framework =
      options.layout === "multi"
        ? `<TargetFrameworks>${tfm};netstandard2.1</TargetFrameworks>`
        : `<TargetFramework>${tfm}</TargetFramework>`;
    const project = `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>
  ${framework}<NuGetAudit>false</NuGetAudit><UseSharedCompilation>false</UseSharedCompilation>
</PropertyGroup>${references}</Project>`;
    await fs.writeFile(projectPath, project);
    if (options.layout === "central") {
      const other = path.join(root, "Other");
      await fs.mkdir(other);
      await fs.writeFile(path.join(other, "Other.csproj"), project);
    }
    return { root, projectPath, feedPath, sdkVersion, cli, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
