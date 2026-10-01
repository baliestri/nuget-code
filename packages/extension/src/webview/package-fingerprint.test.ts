import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { createPackageReferenceFingerprint } from "./package-fingerprint";
it("observes imported inputs, missing files and solution contents without folding Linux case", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nuget-fingerprint-"));
  try {
    const project = path.join(root, "App.csproj");
    const solution = path.join(root, "App.sln");
    const props = path.join(root, "Shared.props");
    await fs.writeFile(project, "project");
    await fs.writeFile(solution, "solution");
    const options = {
      target: {
        id: "s",
        kind: "solution" as const,
        name: "S",
        path: solution,
        projectPaths: [project],
      },
      centralPackageFiles: [],
      inputPaths: [props],
    };
    const before = await createPackageReferenceFingerprint(options);
    await fs.writeFile(props, "props");
    const imported = await createPackageReferenceFingerprint(options);
    expect(imported).not.toBe(before);
    await fs.writeFile(solution, "changed");
    expect(await createPackageReferenceFingerprint(options)).not.toBe(imported);
    if (process.platform !== "win32") {
      const other = path.join(root, "shared.props");
      await fs.writeFile(other, "props");
      expect(
        await createPackageReferenceFingerprint({
          ...options,
          inputPaths: [other],
        }),
      ).not.toBe(await createPackageReferenceFingerprint(options));
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
