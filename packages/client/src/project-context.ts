import type { InstalledReference } from "#contracts";
import type { DotnetSdk } from "#client/dotnet-sdk";

export interface EvaluationOptions {
  projectPath: string;
  allowedRoots: readonly string[];
  feedUrls: readonly string[];
  sourceRevision: string;
  /** Complete, explicit restore configuration; also required by the real executor. */
  restoreConfigPath?: string;
}

export type ProjectInputKind =
  | "project"
  | "import"
  | "global"
  | "configuration"
  | "lock"
  | "generated"
  | "assets"
  | "tool";
export interface ProjectInputSnapshot {
  readonly path: string;
  readonly scopeRoot: string;
  readonly hash: string | null;
  readonly kind: ProjectInputKind;
  readonly copy: boolean;
}
export interface ProjectDirectorySnapshot {
  readonly path: string;
  readonly scopeRoot: string;
  readonly entries: readonly string[];
}
export interface MsbuildFrame {
  readonly framework: string;
  readonly properties: Readonly<Record<string, string>>;
  readonly items: Readonly<
    Record<string, readonly Readonly<Record<string, string>>[]>
  >;
}
export interface EvaluatedProjectNode {
  readonly path: string;
  readonly sdk: DotnetSdk;
  readonly frames: readonly MsbuildFrame[];
  readonly imports: readonly string[];
}
export interface EvaluatedProject {
  readonly projectPath: string;
  readonly root: string;
  readonly sdk: DotnetSdk;
  readonly frameworks: readonly string[];
  readonly inputPaths: readonly string[];
  readonly inputs: readonly ProjectInputSnapshot[];
  readonly directories: readonly ProjectDirectorySnapshot[];
  readonly references: readonly InstalledReference[];
  readonly projects: readonly EvaluatedProjectNode[];
  readonly contextRevision: string;
  readonly sourceRevision: string;
  readonly feedUrls: readonly string[];
  readonly restoreConfigPath: string | null;
  readonly isolation: {
    readonly supported: boolean;
    readonly reasons: readonly string[];
  };
}

export class ProjectContextError extends Error {
  constructor(
    readonly code:
      | "outside-scope"
      | "unsupported-context"
      | "stale-input"
      | "evaluation-failed"
      | "copy-mismatch",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProjectContextError";
  }
}
