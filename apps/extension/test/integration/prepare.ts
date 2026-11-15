/*
 * Builds the workspace the editor opens for the smoke tests: one solution with one project that references
 * a package from a folder feed, restoring into a global packages folder of its own. Run before vscode-test.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPackage } from "../../../../packages/backend-client/test/support/testPackages";
import { backendProject, resolveTestBackend } from "../../../../packages/backend-client/test/support/testBackend";
import { project } from "../../../../packages/backend-client/test/support/testWorkspace";
import { buildConsoleModule } from "../../../../scripts/console-module";

const workspace = fileURLToPath(new URL("../../.vscode-test/workspace/", import.meta.url));

function write(relativePath: string, content: string): void {
  const path = join(workspace, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
mkdirSync(workspace, { recursive: true });

// With NUGET_VSCODE_BACKEND_BUNDLED the extension is left to find the binary under bin/<target>, as an
// installed VSIX does: that is how the packaged backend is tested.
const bundled = (process.env["NUGET_VSCODE_BACKEND_BUNDLED"] ?? "") !== "";
const backend = resolveTestBackend();
if (!bundled && backend.command === "dotnet") {
  execFileSync("dotnet", ["build", backendProject, "-c", "Debug", "-nologo", "-v:q"], { stdio: "inherit" });
}

// The module of the console, where the extension looks for it. A packaged extension already has it.
if (!bundled) {
  const repository = fileURLToPath(new URL("../../../../", import.meta.url));
  buildConsoleModule(repository, join(repository, "apps", "extension", "console"), "Debug");
}

write(
  "NuGet.config",
  `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <clear />
    <add key="local" value="feed" />
  </packageSources>
  <config>
    <add key="globalPackagesFolder" value="global-packages" />
  </config>
</configuration>
`
);
createPackage(join(workspace, "feed"), "Alpha", "1.0.0");
write("App/App.csproj", project({ Alpha: "1.0.0" }));
write("Sample.slnx", '<Solution>\n  <Project Path="App/App.csproj" />\n</Solution>\n');
write(
  ".vscode/settings.json",
  JSON.stringify(
    {
      // The Debug build during development, or a published binary named by NUGET_VSCODE_BACKEND_PATH.
      ...(bundled ? {} : { "nuget.backend.path": backend.command === "dotnet" ? backend.args[0] : backend.command }),
      // Off, so the test of the restore command is what restores.
      "nuget.restore.onOpen": false
    },
    null,
    2
  )
);

console.log(`Smoke test workspace: ${workspace}`);
