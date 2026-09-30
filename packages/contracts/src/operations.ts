export interface MutationStep {
  readonly id: string;
  readonly kind: "package" | "restore" | "clear-cache";
  readonly projectPaths: readonly string[];
  readonly packageId: string | null;
  readonly action:
    | "add"
    | "update"
    | "downgrade"
    | "remove"
    | "restore"
    | "clear";
  readonly version: string | null;
  readonly feedUrls: readonly string[];
  readonly cachePaths?: readonly string[];
}
/** Public intent only. Editor tokens, evaluated inputs and prepared edit plans stay in the host. */
export interface MutationPlan {
  readonly id: string;
  readonly targetId: string;
  readonly contextRevision: string;
  readonly steps: readonly MutationStep[];
}
export interface StepResult {
  stepId: string;
  status: "completed" | "failed" | "not-executed";
  error: string | null;
  changedPaths: readonly string[];
  projects?: readonly {
    projectPath: string;
    status: "completed" | "failed" | "not-executed";
  }[];
}
export interface MutationOutcome {
  operationId: string;
  steps: readonly StepResult[];
  cancelled: boolean;
  reconciliationError: string | null;
}
export interface MutationOperation {
  plan: MutationPlan;
  status:
    | "queued"
    | "preparing"
    | "awaiting-confirmation"
    | "running"
    | "reconciling"
    | "completed"
    | "failed"
    | "cancelled";
  outcome: MutationOutcome | null;
  cancelRequested?: boolean;
  progress?: readonly StepResult[];
  activeStepId?: string | null;
}
