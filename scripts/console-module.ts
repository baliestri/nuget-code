/*
 * Builds the PowerShell module of the Package Manager Console and puts it where the extension looks for
 * it, `apps/extension/console`, with the version of PowerShell it was built for:
 *
 *   pnpm console-module [--configuration Debug|Release]
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The files of the module, relative to its folder. Nothing else of the build output is shipped. */
export const MODULE_FILES = [
  "NuGet.VisualStudioCode.Console.dll",
  "NuGetCode.psd1",
  "NuGetCode.Prompt.ps1",
  "NuGetCode.format.ps1xml",
  "en-US/about_NuGetCode.help.txt"
] as const;

/**
 * The version of `System.Management.Automation` in `Directory.Packages.props`: the PowerShell the module
 * is compiled against, the least it loads in, and the one the extension offers to install.
 */
export function powershellVersion(props: string): string {
  const match = /<PackageVersion\s+Include="System\.Management\.Automation"\s+Version="(\d+\.\d+\.\d+)"\s*\/>/.exec(
    props
  );
  if (match === null) {
    throw new Error("Directory.Packages.props has no version, as X.Y.Z, for System.Management.Automation.");
  }

  return match[1]!;
}

/** Builds the module and replaces `destination` with its files and `version.json`. */
export function buildConsoleModule(repository: string, destination: string, configuration: string): void {
  const project = join(repository, "backend", "src", "NuGet.VisualStudioCode.Console");
  const version = powershellVersion(readFileSync(join(repository, "backend", "Directory.Packages.props"), "utf8"));
  const output = mkdtempSync(join(tmpdir(), "nuget-code-console-"));
  try {
    const args = ["build", project, "-c", configuration, "-nologo", "-v:q", "-o", output];
    console.log(`> dotnet ${args.join(" ")}`);
    const result = spawnSync("dotnet", args, { cwd: repository, stdio: "inherit" });
    if (result.status !== 0) {
      throw new Error(`dotnet build failed with exit code ${result.status ?? "unknown"}.`);
    }

    // Emptied first, so the module never carries a file left by an earlier build.
    rmSync(destination, { recursive: true, force: true });
    for (const file of MODULE_FILES) {
      const source = join(output, file);
      if (!existsSync(source)) {
        throw new Error(`The console module was not built: ${source} is missing.`);
      }

      mkdirSync(dirname(join(destination, file)), { recursive: true });
      copyFileSync(source, join(destination, file));
    }

    writeFileSync(join(destination, "version.json"), `${JSON.stringify({ powershell: version })}\n`);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const repository = fileURLToPath(new URL("../", import.meta.url));
  const index = process.argv.indexOf("--configuration");
  const configuration = index < 0 ? "Debug" : (process.argv[index + 1] ?? "Debug");
  try {
    const destination = join(repository, "apps", "extension", "console");
    buildConsoleModule(repository, destination, configuration);
    console.log(`The console module (${configuration}) is in ${destination}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
