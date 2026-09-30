import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { resolveProjectSdkSnapshot } from "./project-sdk-snapshot";
it("resolves shared SDK selection once per context and still rechecks global.json and effective SDK changes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nuget-sdk-context-"));
  try {
    const projects: string[] = [];
    for (const folder of ["A", "B", "Legacy/C", "Legacy/D"]) {
      const directory = path.join(root, folder);
      await fs.mkdir(directory, { recursive: true });
      projects.push(path.join(directory, "App.csproj"));
    }
    await fs.writeFile(
      path.join(root, "Legacy", "global.json"),
      '{"sdk":{"version":"8.0.425"}}',
    );
    const runDotnet = vi.fn(async (_args: string[], cwd: string) => ({
      code: 0,
      stderr: "",
      stdout: cwd.includes("Legacy") ? "8.0.425" : "10.0.400",
    }));
    const before = await resolveProjectSdkSnapshot(
      { runDotnet } as never,
      projects,
      [root],
      "dotnet",
      new AbortController().signal,
    );
    expect(runDotnet).toHaveBeenCalledTimes(2);
    expect(before.sdks.get(projects[0]!)?.major).toBe(10);
    expect(before.sdks.get(projects[2]!)?.major).toBe(8);
    expect(before.sdks.get(projects[1]!)?.cwd).toBe(path.dirname(projects[1]!));
    await before.revalidate();
    expect(runDotnet).toHaveBeenCalledTimes(4);
    await fs.writeFile(
      path.join(root, "B", "global.json"),
      '{"sdk":{"version":"9.0.318"}}',
    );
    await expect(before.revalidate()).rejects.toThrow(
      "selection inputs changed",
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
