import { spawnSync } from "node:child_process";

export function git(
  cwd: string,
  args: readonly string[],
  allowFailure = false,
): string {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure)
    throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
  return result.status === 0 ? result.stdout.trim() : "";
}

export function gitSucceeds(cwd: string, args: readonly string[]): boolean {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    shell: false,
  });
  if (result.error) throw result.error;
  return result.status === 0;
}
