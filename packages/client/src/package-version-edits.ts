import { createHash } from "node:crypto";
import path from "node:path";
import type {
  PackageVersionEditPlan,
  VersionDeclarationChange,
  VersionDocumentEdit,
  VersionTextEdit,
} from "#contracts";
import { planVersionDeclaration } from "#client/version-declaration";
import { VersionEditError } from "#client/version-edit-error";
import { parseNuGetVersion } from "#manager";
export { VersionEditError } from "#client/version-edit-error";

export interface VersionDocumentSnapshot {
  readonly path: string;
  readonly text: string;
  /** Opaque host token (document version, file handle, etc.), never serialized in a plan. */
  readonly writeToken?: unknown;
}

/** Capability-scoped IO. The host must preserve encoding and reject concurrent edits. */
export interface VersionEditIO {
  read(path: string): Promise<VersionDocumentSnapshot>;
  writeIfUnchanged(
    expected: VersionDocumentSnapshot,
    replacementText: string,
  ): Promise<void>;
}

function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
function identity(file: string): string {
  if (!path.isAbsolute(file))
    throw new VersionEditError(
      "invalid-path",
      "Document and project paths must be canonical and absolute.",
    );
  const value = path.normalize(file);
  return process.platform === "win32" ? value.toLowerCase() : value;
}

export function createVersionEditPlan(options: {
  documents: readonly VersionDocumentSnapshot[];
  changes: readonly VersionDeclarationChange[];
  selectedProjectPaths: readonly string[];
  contextRevision: string;
}): PackageVersionEditPlan {
  if (!options.contextRevision)
    throw new VersionEditError(
      "stale-context",
      "A verified context revision is required.",
    );
  const selected = new Set(options.selectedProjectPaths.map(identity));
  const documents = new Map<string, VersionDocumentSnapshot>();
  for (const document of options.documents) {
    const key = identity(document.path);
    if (documents.has(key))
      throw new VersionEditError(
        "conflicting-edits",
        "Duplicate document snapshots.",
      );
    documents.set(key, document);
  }
  const fileEdits = new Map<string, VersionTextEdit[]>();
  const requests = new Map<string, VersionDeclarationChange>();
  for (const change of options.changes) {
    if (
      !change.affectedProjectPaths.length ||
      change.affectedProjectPaths.some(
        (project) => !selected.has(identity(project)),
      )
    ) {
      throw new VersionEditError(
        "scope-mismatch",
        "Every affected project must be known and selected.",
      );
    }
    const key = identity(change.declarationPath);
    const document = documents.get(key);
    if (!document)
      throw new VersionEditError(
        "missing-document",
        "The declaration has no input snapshot.",
      );
    const edit = planVersionDeclaration(document.text, change);
    if (!edit) continue;
    const edits = fileEdits.get(key) ?? [];
    const overlapping = edits.find(
      (existing) => edit.start < existing.end && existing.start < edit.end,
    );
    if (overlapping) {
      if (JSON.stringify(overlapping) !== JSON.stringify(edit))
        throw new VersionEditError(
          "conflicting-edits",
          "Conflicting edits target the same declaration.",
        );
    } else {
      edits.push(edit);
      fileEdits.set(key, edits);
    }
    const expectedVersion = parseNuGetVersion(
      change.expectedVersion,
    )!.normalized.toLowerCase();
    const requestKey = JSON.stringify([
      key,
      change.kind,
      change.packageId.toLowerCase(),
      expectedVersion,
      edit.replacementText,
    ]);
    const previous = requests.get(requestKey);
    requests.set(
      requestKey,
      Object.freeze({
        ...change,
        declarationPath: document.path,
        packageId: change.packageId.toLowerCase(),
        expectedVersion,
        version: edit.replacementText,
        affectedProjectPaths: Object.freeze(
          [
            ...new Set([
              ...(previous?.affectedProjectPaths ?? []),
              ...change.affectedProjectPaths,
            ]),
          ].sort(),
        ),
      }),
    );
  }
  const files: VersionDocumentEdit[] = [...fileEdits.keys()]
    .sort()
    .map((key) => {
      const document = documents.get(key)!;
      return Object.freeze({
        path: document.path,
        textHash: hash(document.text),
        edits: Object.freeze(
          fileEdits.get(key)!.sort((a, b) => a.start - b.start),
        ),
      });
    });
  return Object.freeze({
    contextRevision: options.contextRevision,
    changes: Object.freeze(
      [...requests.keys()].sort().map((key) => requests.get(key)!),
    ),
    files: Object.freeze(files),
  });
}

/** Applies only host-created plans; mapped application never falls back to source paths. */
export async function applyVersionEditPlan(
  plan: PackageVersionEditPlan,
  options: {
    io: VersionEditIO;
    contextRevision: string;
    fileMap?: ReadonlyMap<string, string>;
  },
): Promise<{ writtenPaths: string[] }> {
  if (plan.contextRevision !== options.contextRevision)
    throw new VersionEditError(
      "stale-context",
      "The evaluated context changed.",
    );
  const targets = plan.files.map((file) => {
    const target = options.fileMap ? options.fileMap.get(file.path) : file.path;
    if (target === undefined)
      throw new VersionEditError(
        "missing-mapping",
        "Every declaration needs an explicit copy mapping.",
      );
    return { file, target, identity: identity(target) };
  });
  if (new Set(targets.map((target) => target.identity)).size !== targets.length)
    throw new VersionEditError(
      "conflicting-edits",
      "Multiple declarations map to the same destination.",
    );
  const prepared: { snapshot: VersionDocumentSnapshot; text: string }[] = [];
  for (const { file, target } of targets) {
    const snapshot = await options.io.read(target);
    if (
      identity(snapshot.path) !== identity(target) ||
      hash(snapshot.text) !== file.textHash
    )
      throw new VersionEditError(
        "stale-document",
        "A declaration changed since planning.",
      );
    let text = snapshot.text;
    for (const edit of [...file.edits].reverse()) {
      if (snapshot.text.slice(edit.start, edit.end) !== edit.expectedText)
        throw new VersionEditError(
          "stale-document",
          "A version token no longer matches the plan.",
        );
      text =
        text.slice(0, edit.start) + edit.replacementText + text.slice(edit.end);
    }
    prepared.push({ snapshot, text });
  }
  const writtenPaths: string[] = [];
  for (const { snapshot, text } of prepared) {
    try {
      await options.io.writeIfUnchanged(snapshot, text);
      writtenPaths.push(snapshot.path);
    } catch (cause) {
      throw new VersionEditError(
        cause instanceof VersionEditError ? cause.code : "write-failed",
        "A version edit could not be applied; completed edits were not rolled back.",
        { writtenPaths, cause },
      );
    }
  }
  return { writtenPaths };
}
