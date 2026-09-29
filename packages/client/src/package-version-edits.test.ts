import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { VersionDeclarationChange } from "#contracts";
import {
  applyVersionEditPlan,
  createVersionEditPlan,
  VersionEditError,
  type VersionDocumentSnapshot,
  type VersionEditIO,
} from "./package-version-edits";

const text =
  '<Project><ItemGroup><PackageReference Include="Demo" Version="1.0.0"/></ItemGroup></Project>';
const change: VersionDeclarationChange = {
  declarationPath: "/repo/Shared.props",
  kind: "PackageReference",
  packageId: "Demo",
  expectedVersion: "1.0.0",
  version: "1.5.0",
  affectedProjectPaths: ["/repo/A.csproj", "/repo/B.csproj"],
};
function plan(
  changes = [change],
  documents = [{ path: change.declarationPath, text }],
) {
  return createVersionEditPlan({
    changes,
    documents,
    contextRevision: "r1",
    selectedProjectPaths: ["/repo/A.csproj", "/repo/B.csproj"],
  });
}
function memoryIO(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial));
  const written: string[] = [];
  let afterWrite: (() => void) | undefined;
  const io: VersionEditIO = {
    async read(file) {
      const contents = files.get(file);
      if (contents === undefined)
        throw new Error("outside the supplied documents");
      return { path: file, text: contents };
    },
    async writeIfUnchanged(snapshot, next) {
      if (files.get(snapshot.path) !== snapshot.text)
        throw new VersionEditError("stale-document", "Document changed.");
      files.set(snapshot.path, next);
      written.push(snapshot.path);
      afterWrite?.();
    },
  };
  return {
    io,
    files,
    written,
    onWrite(callback: () => void) {
      afterWrite = callback;
    },
  };
}

describe("shared version edit plans", () => {
  it("applies the exact same plan to original and explicitly mapped copy documents", async () => {
    const value = plan();
    const original = memoryIO({ [change.declarationPath]: text });
    const copy = memoryIO({ "/copy/Shared.props": text });
    await applyVersionEditPlan(value, {
      io: original.io,
      contextRevision: "r1",
    });
    await applyVersionEditPlan(value, {
      io: copy.io,
      contextRevision: "r1",
      fileMap: new Map([[change.declarationPath, "/copy/Shared.props"]]),
    });
    expect(copy.files.get("/copy/Shared.props")).toBe(
      original.files.get(change.declarationPath),
    );
    expect(value.files[0]?.textHash).toBe(
      createHash("sha256").update(text).digest("hex"),
    );
    expect(value.files[0]?.edits).toHaveLength(1);
  });

  it("refuses incomplete shared scope or an unselected consumer", () => {
    expect(() => plan([{ ...change, affectedProjectPaths: [] }])).toThrow(
      expect.objectContaining({ code: "scope-mismatch" }),
    );
    expect(() =>
      plan([{ ...change, affectedProjectPaths: ["/repo/C.csproj"] }]),
    ).toThrow(expect.objectContaining({ code: "scope-mismatch" }));
  });

  it("deduplicates identical requests and rejects conflicting destinations", () => {
    expect(plan([change, change]).files[0]?.edits).toHaveLength(1);
    expect(() => plan([change, { ...change, version: "2.0.0" }])).toThrow(
      expect.objectContaining({ code: "conflicting-edits" }),
    );
  });

  it("retains every consumer when duplicate requests share a single declaration edit", () => {
    const value = plan([
      { ...change, affectedProjectPaths: ["/repo/A.csproj"] },
      { ...change, affectedProjectPaths: ["/repo/B.csproj"] },
    ]);
    expect(value.changes).toHaveLength(1);
    expect(value.changes[0]?.affectedProjectPaths).toEqual([
      "/repo/A.csproj",
      "/repo/B.csproj",
    ]);
  });

  it("produces the same intent independently of request and document order", () => {
    const other = { ...change, declarationPath: "/repo/Other.props" };
    const documents = [
      { path: change.declarationPath, text },
      { path: other.declarationPath, text },
    ];
    expect(plan([change, other], documents)).toEqual(
      plan([other, change], [...documents].reverse()),
    );
  });

  it("applies multiple edits in one document using the original offsets", async () => {
    const source = text.replace(
      "</ItemGroup>",
      '<PackageReference Include="Other" Version="2.0.0"/></ItemGroup>',
    );
    const other = {
      ...change,
      packageId: "Other",
      expectedVersion: "2.0.0",
      version: "123.0.0",
    };
    const value = plan(
      [change, other],
      [{ path: change.declarationPath, text: source }],
    );
    const state = memoryIO({ [change.declarationPath]: source });
    await applyVersionEditPlan(value, { io: state.io, contextRevision: "r1" });
    expect(state.files.get(change.declarationPath)).toBe(
      source
        .replace('Version="1.0.0"', 'Version="1.5.0"')
        .replace('Version="2.0.0"', 'Version="123.0.0"'),
    );
    expect(state.written).toEqual([change.declarationPath]);
  });

  it("checks all documents before writing any of them", async () => {
    const second = { ...change, declarationPath: "/repo/Second.props" };
    const value = plan(
      [change, second],
      [
        { path: change.declarationPath, text },
        { path: second.declarationPath, text },
      ],
    );
    const state = memoryIO({
      [change.declarationPath]: text,
      [second.declarationPath]: `${text}\n<!-- user change -->`,
    });
    await expect(
      applyVersionEditPlan(value, { io: state.io, contextRevision: "r1" }),
    ).rejects.toMatchObject({ code: "stale-document", writtenPaths: [] });
    expect(state.written).toEqual([]);
  });

  it("never falls back to the original when a copy map is incomplete", async () => {
    const state = memoryIO({ [change.declarationPath]: text });
    await expect(
      applyVersionEditPlan(plan(), {
        io: state.io,
        contextRevision: "r1",
        fileMap: new Map(),
      }),
    ).rejects.toMatchObject({ code: "missing-mapping" });
    expect(state.written).toEqual([]);
  });

  it("rejects duplicate copy destinations before writing", async () => {
    const other = { ...change, declarationPath: "/repo/Other.props" };
    const value = plan(
      [change, other],
      [
        { path: change.declarationPath, text },
        { path: other.declarationPath, text },
      ],
    );
    const state = memoryIO({ "/copy/Shared.props": text });
    await expect(
      applyVersionEditPlan(value, {
        io: state.io,
        contextRevision: "r1",
        fileMap: new Map([
          [change.declarationPath, "/copy/Shared.props"],
          [other.declarationPath, "/copy/Shared.props"],
        ]),
      }),
    ).rejects.toMatchObject({ code: "conflicting-edits" });
    expect(state.written).toEqual([]);
  });

  it("refuses a reader that returns the original document for a mapped destination", async () => {
    const writes: string[] = [];
    await expect(
      applyVersionEditPlan(plan(), {
        contextRevision: "r1",
        fileMap: new Map([[change.declarationPath, "/copy/Shared.props"]]),
        io: {
          read: async () => ({ path: change.declarationPath, text }),
          writeIfUnchanged: async (snapshot) => {
            writes.push(snapshot.path);
          },
        },
      }),
    ).rejects.toMatchObject({ code: "stale-document" });
    expect(writes).toEqual([]);
  });

  it("rejects stale contexts even if document contents match", async () => {
    const state = memoryIO({ [change.declarationPath]: text });
    await expect(
      applyVersionEditPlan(plan(), { io: state.io, contextRevision: "r2" }),
    ).rejects.toMatchObject({ code: "stale-context" });
    expect(state.written).toEqual([]);
  });

  it("reports a concurrent write failure without rolling back a prior successful edit", async () => {
    const a = { ...change, declarationPath: "/repo/A.props" };
    const b = { ...change, declarationPath: "/repo/B.props" };
    const value = plan(
      [a, b],
      [
        { path: a.declarationPath, text },
        { path: b.declarationPath, text },
      ],
    );
    const state = memoryIO({
      [a.declarationPath]: text,
      [b.declarationPath]: text,
    });
    state.onWrite(() =>
      state.files.set(
        b.declarationPath,
        `${text}\n<!-- concurrent user change -->`,
      ),
    );
    await expect(
      applyVersionEditPlan(value, { io: state.io, contextRevision: "r1" }),
    ).rejects.toMatchObject({
      code: "stale-document",
      writtenPaths: [a.declarationPath],
    });
    expect(state.files.get(a.declarationPath)).toContain('Version="1.5.0"');
    expect(state.files.get(b.declarationPath)).toContain(
      "concurrent user change",
    );
  });

  it("does not require a writer for a no-op plan", async () => {
    const value = plan([{ ...change, version: "1.0.0" }]);
    const state = memoryIO({});
    expect(
      await applyVersionEditPlan(value, {
        io: state.io,
        contextRevision: "r1",
      }),
    ).toEqual({ writtenPaths: [] });
  });

  it("preserves the source snapshot object and its opaque concurrency token at the writer boundary", async () => {
    const snapshot: VersionDocumentSnapshot = {
      path: change.declarationPath,
      text,
      writeToken: { version: 42 },
    };
    let received: VersionDocumentSnapshot | undefined;
    await applyVersionEditPlan(plan(), {
      contextRevision: "r1",
      io: {
        read: async () => snapshot,
        writeIfUnchanged: async (expected) => {
          received = expected;
        },
      },
    });
    expect(received).toBe(snapshot);
  });
});
