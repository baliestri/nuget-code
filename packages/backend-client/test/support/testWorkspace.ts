import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createPackage } from "./testPackages";

const CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <clear />
    <add key="local" value="feed" />
  </packageSources>
  <config>
    <add key="globalPackagesFolder" value="global-packages" />
  </config>
</configuration>
`;

/**
 * A temporary folder set up so a restore touches nothing outside it: the inherited package sources are
 * cleared, the only source is the `feed` folder, and the global packages folder is inside the workspace.
 */
export class TestWorkspace {
  // The real path: on Windows the temporary directory may be given in its short 8.3 form, and the backend
  // answers with the long one.
  readonly path = realpathSync.native(mkdtempSync(join(tmpdir(), "nuget-code-tests-")));

  constructor() {
    mkdirSync(this.resolve("feed"));
    this.writeFile("NuGet.config", CONFIG);
  }

  resolve(...segments: string[]): string {
    return join(this.path, ...segments);
  }

  writeFile(relativePath: string, content: string): string {
    const path = this.resolve(relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    return path;
  }

  /** Writes `<name>/<name>.csproj`. */
  writeProject(name: string, packages: Record<string, string> = {}): string {
    return this.writeFile(`${name}/${name}.csproj`, project(packages));
  }

  /** Writes `<name>.slnx` listing the projects written with `writeProject`. */
  writeSolution(name: string, ...projects: string[]): string {
    const lines = projects.map((item) => `  <Project Path="${item}/${item}.csproj" />`);
    return this.writeFile(`${name}.slnx`, `<Solution>\n${lines.join("\n")}\n</Solution>\n`);
  }

  addPackage(id: string, version: string): void {
    createPackage(this.resolve("feed"), id, version);
  }

  /** Replaces the package sources, keeping the isolated global packages folder. */
  writeSources(sourcesXml: string): void {
    this.writeFile(
      "NuGet.config",
      `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <clear />
${sourcesXml}
  </packageSources>
  <config>
    <add key="globalPackagesFolder" value="global-packages" />
  </config>
</configuration>
`
    );
  }

  dispose(): void {
    rmSync(this.path, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

export function project(packages: Record<string, string>): string {
  const references = Object.entries(packages).map(
    ([id, version]) => `    <PackageReference Include="${id}" Version="${version}" />`
  );
  const items = references.length === 0 ? "" : `  <ItemGroup>\n${references.join("\n")}\n  </ItemGroup>\n`;
  return `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
  </PropertyGroup>
${items}</Project>
`;
}
