import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { evaluateProject } from "./project-evaluation";
import {
  createCompatibilitySandbox,
  validateCompatibilitySandbox,
  sandboxVersionEditIO,
} from "./compatibility-sandbox";
import {
  createVersionEditPlan,
  applyVersionEditPlan,
} from "./package-version-edits";
import { decodeProjectText, encodeProjectText } from "./project-files";
import { contextFixture } from "./test/project-context-fixture";

describe("owned compatibility copies", () => {
  it("copies only declared inputs and leaves originals unchanged", async () => {
    const fixture = await contextFixture();
    try {
      await fs.writeFile(
        path.join(fixture.root, "unrelated.txt"),
        "do not copy",
      );
      const evaluated = await evaluateProject(fixture.cli, fixture.options);
      const original = await fs.readFile(fixture.projects[0]!);
      const sandbox = await createCompatibilitySandbox(evaluated);
      try {
        expect(await fs.readFile(sandbox.projectPath)).toEqual(original);
        await expect(
          fs.stat(path.join(sandbox.workspacePath, "unrelated.txt")),
        ).rejects.toMatchObject({ code: "ENOENT" });
        expect(await fs.readFile(sandbox.restoreConfigPath, "utf8")).toContain(
          sandbox.packagesPath,
        );
        await validateCompatibilitySandbox(fixture.cli, evaluated, sandbox);
        await fs.writeFile(sandbox.projectPath, "copy changed");
        expect(await fs.readFile(fixture.projects[0]!)).toEqual(original);
      } finally {
        await sandbox.dispose();
        await sandbox.dispose();
      }
      await expect(fs.stat(sandbox.root)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await fixture.dispose();
    }
  });

  it("refuses to materialize stale input or newly discovered consumers", async () => {
    const fixture = await contextFixture(true);
    try {
      const evaluated = await evaluateProject(fixture.cli, fixture.options);
      await fs.writeFile(path.join(fixture.root, "C.csproj"), "<Project/>");
      await expect(createCompatibilitySandbox(evaluated)).rejects.toMatchObject(
        { code: "stale-input" },
      );
    } finally {
      await fixture.dispose();
    }
  });

  it("does not materialize an unsupported context", async () => {
    const fixture = await contextFixture();
    try {
      await fs.rm(path.join(fixture.root, "Directory.Build.targets"));
      const evaluated = await evaluateProject(fixture.cli, fixture.options);
      await expect(createCompatibilitySandbox(evaluated)).rejects.toMatchObject(
        { code: "unsupported-context" },
      );
    } finally {
      await fixture.dispose();
    }
  });

  it("uses the shared plan while preserving UTF-16 bytes and refusing original paths", async () => {
    const fixture = await contextFixture();
    try {
      const originalText = `\ufeff${await fs.readFile(fixture.projects[0]!, "utf8")}`;
      const originalBytes = encodeProjectText({
        text: originalText,
        encoding: "utf16be",
      });
      await fs.writeFile(fixture.projects[0]!, originalBytes);
      const evaluated = await evaluateProject(fixture.cli, fixture.options);
      const sandbox = await createCompatibilitySandbox(evaluated);
      try {
        const plan = createVersionEditPlan({
          contextRevision: evaluated.contextRevision,
          documents: [{ path: evaluated.projectPath, text: originalText }],
          selectedProjectPaths: [evaluated.projectPath],
          changes: [
            {
              declarationPath: evaluated.projectPath,
              kind: "PackageReference",
              packageId: "Demo",
              expectedVersion: "1.0.0",
              version: "1.5.0",
              affectedProjectPaths: [evaluated.projectPath],
            },
          ],
        });
        const io = sandboxVersionEditIO(sandbox);
        await expect(io.read(evaluated.projectPath)).rejects.toMatchObject({
          code: "invalid-path",
        });
        await applyVersionEditPlan(plan, {
          contextRevision: evaluated.contextRevision,
          fileMap: sandbox.sourceToCopy,
          io,
        });
        const copied = decodeProjectText(
          await fs.readFile(sandbox.projectPath),
        );
        expect(copied.encoding).toBe("utf16be");
        expect(copied.text).toContain('Version="1.5.0"');
        expect(copied.text.startsWith("\ufeff")).toBe(true);
        expect(await fs.readFile(evaluated.projectPath)).toEqual(originalBytes);
      } finally {
        await sandbox.dispose();
      }
    } finally {
      await fixture.dispose();
    }
  });

  it("cleans its own directory after a failed materialization", async () => {
    const fixture = await contextFixture();
    const created: string[] = [];
    const mkdir = fs.mkdtemp;
    const write = fs.writeFile;
    let creation: ReturnType<typeof vi.spyOn> | undefined;
    let writing: ReturnType<typeof vi.spyOn> | undefined;
    try {
      const evaluated = await evaluateProject(fixture.cli, fixture.options);
      creation = vi.spyOn(fs, "mkdtemp").mockImplementation(async (...args) => {
        const result = await mkdir(...args);
        if (String(args[0]).includes("nuget-verification-"))
          created.push(String(result));
        return result;
      });
      writing = vi
        .spyOn(fs, "writeFile")
        .mockImplementation(async (...args) => {
          if (String(args[0]).includes("nuget-verification-"))
            throw new Error("simulated write failure");
          return write(...args);
        });
      await expect(createCompatibilitySandbox(evaluated)).rejects.toThrow(
        "simulated write failure",
      );
      expect(created).toHaveLength(1);
      await expect(fs.stat(created[0]!)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      creation?.mockRestore();
      writing?.mockRestore();
      await fixture.dispose();
    }
  });
});
