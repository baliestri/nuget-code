import type {
  MutationOutcome,
  MutationPlan,
  MutationStep,
  StepResult,
} from "#contracts";
export interface MutationPort {
  execute(step: MutationStep): Promise<readonly string[] | void>;
  reconcile(plan: MutationPlan): Promise<void>;
}
export async function runMutation(
  plan: MutationPlan,
  port: MutationPort,
  cancelled: () => boolean,
  progress?: (steps: readonly StepResult[]) => void,
): Promise<MutationOutcome> {
  const steps: StepResult[] = plan.steps.map((step) => ({
    stepId: step.id,
    status: "not-executed",
    error: null,
    changedPaths: [],
  }));
  let reconciliationError: string | null = null;
  try {
    for (let i = 0; i < plan.steps.length; i++) {
      if (cancelled()) break;
      try {
        const changedPaths = await port.execute(plan.steps[i]!);
        steps[i] = {
          stepId: plan.steps[i]!.id,
          status: "completed",
          error: null,
          changedPaths: changedPaths ?? [],
        };
        progress?.(steps.map((step) => ({ ...step })));
      } catch (error) {
        if (
          cancelled() &&
          error instanceof Error &&
          error.name === "AbortError"
        ) {
          steps[i] = {
            ...steps[i]!,
            changedPaths:
              "changedPaths" in error && Array.isArray(error.changedPaths)
                ? error.changedPaths
                : [],
            ...("projects" in error && Array.isArray(error.projects)
              ? { projects: error.projects }
              : {}),
          };
          break;
        }
        steps[i] = {
          stepId: plan.steps[i]!.id,
          status: "failed",
          error:
            error instanceof Error
              ? error.message
              : "Package operation failed.",
          changedPaths:
            error &&
            typeof error === "object" &&
            "changedPaths" in error &&
            Array.isArray(error.changedPaths)
              ? error.changedPaths.filter(
                  (value): value is string => typeof value === "string",
                )
              : [],
        };
        if (
          error &&
          typeof error === "object" &&
          "projects" in error &&
          Array.isArray(error.projects)
        )
          steps[i]!.projects = error.projects;
        break;
      }
    }
  } finally {
    try {
      await port.reconcile(plan);
    } catch (error) {
      reconciliationError =
        error instanceof Error
          ? error.message
          : "Could not reconcile package state.";
    }
  }
  return {
    operationId: plan.id,
    steps,
    cancelled: cancelled(),
    reconciliationError,
  };
}
