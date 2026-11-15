import { join } from "node:path";
import type { BackendLaunch } from "@nuget-code/backend-client";

const EXECUTABLE = "NuGet.VisualStudioCode";

const ARCHITECTURES = new Set(["x64", "arm64"]);

/** The VSIX target of a platform: the name of the folder that holds its backend binary. */
export function targetOf(platform: string, arch: string, isMusl: boolean): string | undefined {
  if (!ARCHITECTURES.has(arch)) {
    return undefined;
  }

  switch (platform) {
    case "win32":
    case "darwin":
      return `${platform}-${arch}`;
    case "linux":
      return `${isMusl ? "alpine" : "linux"}-${arch}`;
    default:
      return undefined;
  }
}

/** Whether this Node process runs on musl libc (Alpine) rather than glibc. */
export function isMuslRuntime(): boolean {
  if (process.platform !== "linux") {
    return false;
  }

  const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined;
  return report?.header?.glibcVersionRuntime === undefined;
}

export interface LocateInput {
  extensionPath: string;
  /** The `nuget.backend.path` setting; empty when unset. */
  override: string;
  platform: string;
  arch: string;
  isMusl: boolean;
  exists: (path: string) => boolean;
}

export type LocateResult = { launch: BackendLaunch } | { error: string };

/** Which backend to start: the override when there is one, else the binary shipped for this platform. */
export function locateBackend(input: LocateInput): LocateResult {
  if (input.override !== "") {
    if (!input.exists(input.override)) {
      return { error: `The NuGet backend set in nuget.backend.path was not found: ${input.override}` };
    }

    return input.override.toLowerCase().endsWith(".dll")
      ? { launch: { command: "dotnet", args: [input.override] } }
      : { launch: { command: input.override, args: [] } };
  }

  const target = targetOf(input.platform, input.arch, input.isMusl);
  if (target === undefined) {
    return { error: `The NuGet backend is not available for ${input.platform} ${input.arch}.` };
  }

  const file = input.platform === "win32" ? `${EXECUTABLE}.exe` : EXECUTABLE;
  const path = join(input.extensionPath, "bin", target, file);
  return input.exists(path)
    ? { launch: { command: path, args: [] } }
    : { error: `The NuGet backend was not found at ${path}. Reinstall the extension for this platform.` };
}
