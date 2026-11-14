/** One VSIX is built per target: the editor's name for a platform, and the .NET runtime identifier for it. */
export interface Target {
  /** The `--target` of vsce, and the folder name under `apps/extension/bin`. */
  vsce: string;
  /** The runtime identifier `dotnet publish` takes. */
  rid: string;
  executable: string;
}

const NAME = "NuGet.VisualStudioCode";

function target(vsce: string, rid: string): Target {
  return { vsce, rid, executable: rid.startsWith("win-") ? `${NAME}.exe` : NAME };
}

export const TARGETS: readonly Target[] = [
  target("win32-x64", "win-x64"),
  target("win32-arm64", "win-arm64"),
  target("linux-x64", "linux-x64"),
  target("linux-arm64", "linux-arm64"),
  target("alpine-x64", "linux-musl-x64"),
  target("alpine-arm64", "linux-musl-arm64"),
  target("darwin-x64", "osx-x64"),
  target("darwin-arm64", "osx-arm64")
];

export function findTarget(name: string): Target | undefined {
  return TARGETS.find((item) => item.vsce === name);
}
