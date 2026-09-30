import path from "node:path";
import { createHash } from "node:crypto";
import { resolveDotnetSdk, type DotnetSdk } from "#client/dotnet-sdk";
import type { NuGetClientLogger } from "#client/types";
import { containsPath, pathKey, readScopedFile } from "#client/project-files";

type Cli = Parameters<typeof resolveDotnetSdk>[0];
interface Selection {
  keys: Map<string, string>;
  inputs: Map<string, string>;
  signature: string;
}
async function selection(
  projects: readonly string[],
  roots: readonly string[],
  executable: string,
  signal: AbortSignal,
): Promise<Selection> {
  const inputs = new Map<string, string>();
  const keys = new Map<string, string>();
  const reads = new Map<string, Promise<Buffer | null>>();
  for (const project of projects) {
    signal.throwIfAborted();
    const root = roots
      .filter((root) => containsPath(root, project))
      .sort((a, b) => a.length - b.length)[0];
    let key = `directory:${pathKey(path.dirname(project))}`;
    if (root) {
      let directory = path.dirname(project);
      key = `ancestor:${pathKey(root)}`;
      for (;;) {
        const file = path.join(directory, "global.json");
        let pending = reads.get(file);
        if (!pending) {
          pending = readScopedFile(file, root);
          reads.set(file, pending);
        }
        try {
          const bytes = await pending;
          inputs.set(
            file,
            bytes
              ? createHash("sha256").update(bytes).digest("hex")
              : "missing",
          );
          if (bytes) {
            key = `global:${pathKey(file)}`;
            break;
          }
        } catch (error) {
          if (signal.aborted) throw error;
          inputs.set(file, "unreadable");
          key = `unproven:${pathKey(project)}`;
          break;
        }
        if (pathKey(directory) === pathKey(root)) break;
        directory = path.dirname(directory);
      }
    }
    // Relative launchers may resolve to different executables in different project directories.
    if (!path.isAbsolute(executable) && /[/\\]/.test(executable))
      key += `:${pathKey(path.dirname(project))}`;
    keys.set(project, key);
  }
  return {
    keys,
    inputs,
    signature: JSON.stringify([[...keys].sort(), [...inputs].sort()]),
  };
}

/** Per-read memoization, never a long-lived SDK cache. Both selection inputs and effective versions are rechecked. */
export async function resolveProjectSdkSnapshot(
  cli: Cli,
  projects: readonly string[],
  roots: readonly string[],
  executable: string,
  signal: AbortSignal,
  logger?: NuGetClientLogger,
): Promise<{
  sdks: ReadonlyMap<string, DotnetSdk>;
  inputPaths: readonly string[];
  revalidate(): Promise<void>;
}> {
  const before = await selection(projects, roots, executable, signal);
  const groups = new Map<string, { project: string; sdk: DotnetSdk }>();
  const sdks = new Map<string, DotnetSdk>();
  for (const project of projects) {
    const key = before.keys.get(project)!;
    let group = groups.get(key);
    if (!group) {
      group = { project, sdk: await resolveDotnetSdk(cli, project, signal) };
      groups.set(key, group);
    }
    sdks.set(project, { ...group.sdk, cwd: path.dirname(project) });
  }
  logger?.verbose(
    "nuget.sdk",
    `Resolved ${projects.length} project SDKs through ${groups.size} selection context(s).`,
  );
  return {
    sdks,
    inputPaths: [...before.inputs.keys()],
    async revalidate() {
      const after = await selection(projects, roots, executable, signal);
      if (before.signature !== after.signature)
        throw new Error(
          "SDK selection inputs changed during inventory loading.",
        );
      for (const group of groups.values())
        if (
          (await resolveDotnetSdk(cli, group.project, signal)).version !==
          group.sdk.version
        )
          throw new Error(
            "The effective SDK changed during inventory loading.",
          );
    },
  };
}
