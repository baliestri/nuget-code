export interface VersionDeclarationChange {
  readonly declarationPath: string;
  readonly kind: "PackageReference" | "PackageVersion";
  readonly packageId: string;
  readonly expectedVersion: string;
  readonly version: string;
  /** Complete consumer scope supplied by project evaluation, not by the UI. */
  readonly affectedProjectPaths: readonly string[];
}

export interface VersionTextEdit {
  /** UTF-16 string offsets in the original document snapshot. */
  readonly start: number;
  readonly end: number;
  readonly expectedText: string;
  readonly replacementText: string;
}

export interface VersionDocumentEdit {
  readonly path: string;
  readonly textHash: string;
  readonly edits: readonly VersionTextEdit[];
}

/** Host-prepared intent. Never execute a plan supplied by a webview message. */
export interface PackageVersionEditPlan {
  readonly contextRevision: string;
  readonly changes: readonly VersionDeclarationChange[];
  readonly files: readonly VersionDocumentEdit[];
}
