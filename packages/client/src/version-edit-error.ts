export type VersionEditFailure =
  | "invalid-xml"
  | "invalid-version"
  | "invalid-path"
  | "unsupported-declaration"
  | "ambiguous-declaration"
  | "source-version-mismatch"
  | "scope-mismatch"
  | "missing-document"
  | "conflicting-edits"
  | "stale-context"
  | "stale-document"
  | "missing-mapping"
  | "write-failed";

export class VersionEditError extends Error {
  readonly writtenPaths: readonly string[];

  constructor(
    readonly code: VersionEditFailure,
    message: string,
    options: {
      writtenPaths?: readonly string[];
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "VersionEditError";
    this.writtenPaths = Object.freeze([...(options.writtenPaths ?? [])]);
  }
}
