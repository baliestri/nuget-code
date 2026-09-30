import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { createVersionEditIO, type EditorPort } from "./version-edit-io";
import { decodeProjectText, encodeProjectText } from "#client/project-files";
it("preserves UTF-16 BOM/CRLF and refuses concurrent filesystem edits", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nuget-edit-"));
  const file = path.join(root, "Shared.props");
  const source = {
    text: "\ufeff<Project>\r\n<Version>1.0.0</Version>\r\n</Project>",
    encoding: "utf16be" as const,
  };
  const editor: EditorPort = {
    open: async (file) => {
      const bytes = await fs.readFile(file);
      const original = decodeProjectText(bytes);
      const bom = original.text.startsWith("\ufeff");
      let text = original.text.slice(bom ? 1 : 0);
      let version = 1;
      return {
        version: () => version,
        text: () => text,
        dirty: () => false,
        edit: async (expected, next) => {
          if (expected !== version) return false;
          text = next;
          version++;
          return true;
        },
        save: async () => {
          if (!(await fs.readFile(file)).equals(bytes)) return false;
          await fs.writeFile(
            file,
            encodeProjectText(original, (bom ? "\ufeff" : "") + text),
          );
          return true;
        },
      };
    },
  };
  try {
    await fs.writeFile(file, encodeProjectText(source));
    const io = createVersionEditIO(new Map([[file, root]]), editor);
    const snapshot = await io.read(file);
    await io.writeIfUnchanged(
      snapshot,
      snapshot.text.replace("1.0.0", "1.5.0"),
    );
    expect(await fs.readFile(file)).toEqual(
      encodeProjectText(source, source.text.replace("1.0.0", "1.5.0")),
    );
    const next = await io.read(file);
    await fs.writeFile(
      file,
      encodeProjectText(source, source.text + "<!-- user -->"),
    );
    await expect(
      io.writeIfUnchanged(next, next.text.replace("1.5.0", "2.0.0")),
    ).rejects.toMatchObject({ code: "stale-document" });
    expect(await fs.readFile(file)).toEqual(
      encodeProjectText(source, source.text + "<!-- user -->"),
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
