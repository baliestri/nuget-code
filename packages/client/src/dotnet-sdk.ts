import path from "node:path";
import type { NuGetCli } from "#client/cli";

export interface DotnetSdk {
  version: string;
  major: number;
  cwd: string;
}

export type DotnetAction =
  | {
      kind: "list";
      projectPath: string;
      outdated: boolean;
      noRestore?: boolean;
    }
  | { kind: "add"; projectPath: string; packageId: string; version: string }
  | { kind: "remove"; projectPath: string; packageId: string };

export type SdkResolutionFailure =
  | "missing"
  | "pinned-unavailable"
  | "unsupported"
  | "invalid-output";

export class SdkResolutionError extends Error {
  constructor(
    readonly code: SdkResolutionFailure,
    message: string,
  ) {
    super(message);
    this.name = "SdkResolutionError";
  }
}

/** Let the configured dotnet host resolve global.json and roll-forward policy. */
export async function resolveDotnetSdk(
  cli: Pick<NuGetCli, "runDotnet">,
  projectPath: string,
  signal?: AbortSignal,
): Promise<DotnetSdk> {
  const cwd = path.dirname(path.resolve(projectPath));
  const result = await cli.runDotnet(["--version"], cwd, { signal });
  if (result.failure) {
    throw new SdkResolutionError(
      "missing",
      "Could not start dotnet. Check the configured executable and project directory; use a native executable, not a batch launcher.",
    );
  }
  if (result.code !== 0) {
    // NuGetCli requests English diagnostics for this machine-readable boundary.
    const diagnostic = `${result.stderr}\n${result.stdout}`;
    if (/no \.NET SDKs were found|no SDKs were found/i.test(diagnostic)) {
      throw new SdkResolutionError(
        "missing",
        "No .NET SDK is installed for the configured dotnet executable.",
      );
    }
    if (
      /compatible \.NET SDK was not found|requested SDK version:/i.test(
        diagnostic,
      )
    ) {
      throw new SdkResolutionError(
        "pinned-unavailable",
        "The SDK required by global.json is unavailable. Install it or update the project's SDK selection.",
      );
    }
    throw new SdkResolutionError(
      "invalid-output",
      "Could not resolve the project SDK. Check global.json and the dotnet configuration.",
    );
  }
  const version = result.stdout.trim();
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9a-z.-]+)?$/i.test(version)) {
    throw new SdkResolutionError(
      "invalid-output",
      "dotnet --version did not return a valid SDK version.",
    );
  }
  const major = Number(version.split(".")[0]);
  if (major < 8) {
    throw new SdkResolutionError(
      "unsupported",
      "NuGet Manager requires .NET SDK 8 or later in the project context.",
    );
  }
  return { version, major, cwd };
}

export function supportsListNoRestore(sdk: DotnetSdk): boolean {
  return sdk.major >= 10;
}

export function dotnetArguments(
  sdk: DotnetSdk,
  action: DotnetAction,
): string[] {
  if (sdk.major < 8) {
    throw new SdkResolutionError(
      "unsupported",
      "NuGet Manager requires .NET SDK 8 or later.",
    );
  }
  const modern = sdk.major >= 10;
  switch (action.kind) {
    case "add":
      return modern
        ? [
            "package",
            "add",
            action.packageId,
            "--project",
            action.projectPath,
            "--version",
            action.version,
          ]
        : [
            "add",
            action.projectPath,
            "package",
            action.packageId,
            "--version",
            action.version,
          ];
    case "remove":
      return modern
        ? [
            "package",
            "remove",
            action.packageId,
            "--project",
            action.projectPath,
          ]
        : ["remove", action.projectPath, "package", action.packageId];
    case "list": {
      if (action.noRestore && !supportsListNoRestore(sdk)) {
        throw new RangeError(
          "dotnet list --no-restore requires SDK 10 or later.",
        );
      }
      return [
        ...(modern
          ? ["package", "list", "--project", action.projectPath]
          : ["list", action.projectPath, "package"]),
        ...(action.outdated ? ["--outdated"] : []),
        "--include-transitive",
        "--format",
        "json",
        "--output-version",
        "1",
        ...(action.noRestore ? ["--no-restore"] : []),
      ];
    }
  }
}
