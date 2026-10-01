import { Uri, Range, workspace, window } from "vscode";
import {
  contentHash,
  decodeProjectText,
  encodeProjectText,
  readScopedFile,
} from "#client/project-files";
import {
  VersionEditError,
  type VersionDocumentSnapshot,
  type VersionEditIO,
} from "#client/package-version-edits";

export interface EditorDocument {
  version(): number;
  text(): string;
  dirty(): boolean;
  edit(expectedVersion: number, text: string): Promise<boolean>;
  save(): Promise<boolean>;
}
export interface EditorPort {
  open(file: string): Promise<EditorDocument>;
}
export const vscodeEditorPort: EditorPort = {
  async open(file) {
    const document = await workspace.openTextDocument(Uri.file(file));
    const editor = await window.showTextDocument(document, {
      preserveFocus: true,
      preview: false,
    });
    return {
      version: () => document.version,
      text: () => document.getText(),
      dirty: () => document.isDirty || document.isClosed,
      edit: async (version, text) => {
        if (document.version !== version || document.isClosed) return false;
        // TextEditor.edit submits the document's version and is rejected if the model changed.
        return editor.edit(
          (builder) =>
            builder.replace(
              new Range(
                document.positionAt(0),
                document.positionAt(document.getText().length),
              ),
              text,
            ),
          { undoStopBefore: true, undoStopAfter: true },
        );
      },
      save: async () => document.save(),
    };
  },
};

/** Only explicitly captured declaration files can be edited; buffers and encodings are checked independently. */
export function createVersionEditIO(
  files: ReadonlyMap<string, string>,
  editorPort: EditorPort = vscodeEditorPort,
  cancelled: () => boolean = () => false,
): VersionEditIO & { changedPaths: Set<string> } {
  const changedPaths = new Set<string>();
  const tokens = new WeakMap<
    VersionDocumentSnapshot,
    {
      document: EditorDocument;
      version: number;
      hash: string;
      source: ReturnType<typeof decodeProjectText>;
      bomOffset: number;
      root: string;
    }
  >();
  return {
    changedPaths,
    async read(file) {
      const root = files.get(file);
      if (!root)
        throw new VersionEditError(
          "invalid-path",
          "Declaration is outside the prepared file capability.",
        );
      const bytes = await readScopedFile(file, root);
      if (!bytes)
        throw new VersionEditError(
          "missing-document",
          "Declaration no longer exists.",
        );
      const source = decodeProjectText(bytes);
      const document = await editorPort.open(file);
      const bomOffset =
        source.text.startsWith("\ufeff") &&
        document.text() === source.text.slice(1)
          ? 1
          : 0;
      if (document.dirty() || document.text() !== source.text.slice(bomOffset))
        throw new VersionEditError(
          "stale-document",
          "Save or resolve changes in the declaration before retrying.",
        );
      const snapshot = { path: file, text: source.text };
      tokens.set(snapshot, {
        root,
        document,
        version: document.version(),
        hash: contentHash(bytes),
        source,
        bomOffset,
      });
      return snapshot;
    },
    async writeIfUnchanged(expected, replacement) {
      if (cancelled())
        throw new DOMException("Operation cancelled.", "AbortError");
      const token = tokens.get(expected);
      if (!token)
        throw new VersionEditError(
          "stale-document",
          "The editor snapshot is no longer valid.",
        );
      const bytes = await readScopedFile(expected.path, token.root);
      if (
        !bytes ||
        contentHash(bytes) !== token.hash ||
        token.document.dirty() ||
        token.document.version() !== token.version ||
        token.document.text() !== expected.text.slice(token.bomOffset)
      )
        throw new VersionEditError(
          "stale-document",
          "The declaration changed before the edit could be applied.",
        );
      if (
        !(await token.document.edit(
          token.version,
          replacement.slice(token.bomOffset),
        ))
      )
        throw new VersionEditError(
          "stale-document",
          "The editor rejected an outdated document edit.",
        );
      changedPaths.add(expected.path);
      tokens.delete(expected);
      if (
        token.document.text() !== replacement.slice(token.bomOffset) ||
        !(await token.document.save())
      )
        throw new VersionEditError(
          "write-failed",
          "The declaration was edited but could not be saved. Resolve the editor buffer before retrying.",
        );
      const saved = await readScopedFile(expected.path, token.root);
      if (!saved?.equals(encodeProjectText(token.source, replacement)))
        throw new VersionEditError(
          "write-failed",
          "The saved document changed during save or used a different encoding. No rollback was attempted.",
        );
    },
  };
}
