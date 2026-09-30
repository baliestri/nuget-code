import { randomUUID } from "node:crypto";
import type {
  MutationOperation,
  MutationOutcome,
  MutationPlan,
  MutationStep,
} from "#contracts";
import { freezeMutationPlan, sameMutationIntent } from "#manager";
import { MutationQueue } from "#extension/webview/mutation-queue";
import { runMutation } from "#extension/webview/mutation-runner";

export interface PreparedMutation {
  plan: MutationPlan;
  execute(
    step: MutationStep,
    cancelled?: () => boolean,
  ): Promise<readonly string[] | void>;
}
export interface OperationPort {
  run?<T>(work: () => Promise<T>): Promise<T>;
  prepare(plan: MutationPlan, signal: AbortSignal): Promise<PreparedMutation>;
  reconcile(plan: MutationPlan): Promise<void>;
}
interface ActiveOperation {
  record: MutationOperation;
  controller: AbortController;
  port: OperationPort;
  confirmation?: { revision: string; resolve(accepted: boolean): void };
}
export class MutationService {
  private readonly queue = new MutationQueue();
  private readonly operations = new Map<string, ActiveOperation>();
  constructor(
    private readonly publish: (
      operations: readonly MutationOperation[],
    ) => void,
  ) {}
  submit(plan: MutationPlan, port: OperationPort): Promise<MutationOutcome> {
    if (this.operations.has(plan.id))
      return Promise.reject(new Error("Operation already exists."));
    const operation: ActiveOperation = {
      record: {
        plan: freezeMutationPlan(plan),
        status: "queued",
        outcome: null,
      },
      controller: new AbortController(),
      port,
    };
    this.operations.set(plan.id, operation);
    this.emit();
    return this.queue
      .enqueue(
        plan.id,
        () =>
          port.run
            ? port.run(() => this.execute(operation))
            : this.execute(operation),
        operation.controller.signal,
      )
      .catch((error) => {
        const outcome: MutationOutcome = {
          operationId: plan.id,
          cancelled: operation.controller.signal.aborted,
          reconciliationError: null,
          steps: plan.steps.map((step) => ({
            stepId: step.id,
            status: "not-executed",
            error: operation.controller.signal.aborted ? null : String(error),
            changedPaths: [],
          })),
        };
        this.finish(operation, outcome);
        return outcome;
      });
  }
  cancel(id: string): void {
    const operation = this.operations.get(id);
    if (
      operation &&
      !operation.record.outcome &&
      operation.record.status !== "reconciling"
    ) {
      operation.record = { ...operation.record, cancelRequested: true };
      operation.controller.abort();
      operation.confirmation?.resolve(false);
      this.emit();
    }
  }
  confirm(id: string, revision: string, accepted: boolean): boolean {
    const operation = this.operations.get(id);
    if (
      !operation?.confirmation ||
      operation.confirmation.revision !== revision ||
      operation.controller.signal.aborted
    )
      return false;
    const confirmation = operation.confirmation;
    delete operation.confirmation;
    confirmation.resolve(accepted);
    return true;
  }
  retry(id: string): Promise<MutationOutcome> | undefined {
    const previous = this.operations.get(id);
    if (!previous?.record.outcome) return undefined;
    const pending = new Set(
      previous.record.outcome.steps
        .filter((step) => step.status !== "completed")
        .map((step) => step.stepId),
    );
    const steps = previous.record.plan.steps
      .filter((step) => pending.has(step.id))
      .map((step) => {
        const completed = new Set(
          previous.record
            .outcome!.steps.find((result) => result.stepId === step.id)
            ?.projects?.filter((project) => project.status === "completed")
            .map((project) => project.projectPath) ?? [],
        );
        return {
          ...step,
          projectPaths: step.projectPaths.filter(
            (project) => !completed.has(project),
          ),
        };
      });
    // A reconciliation-only failure needs no replay of successful commands.
    return this.submit(
      { ...previous.record.plan, id: randomUUID(), steps },
      previous.port,
    );
  }
  dispose(): void {
    for (const operation of this.operations.values())
      this.cancel(operation.record.plan.id);
    this.queue.dispose();
  }
  private async prepare(
    operation: ActiveOperation,
    expected: MutationPlan,
  ): Promise<PreparedMutation> {
    let approved = expected;
    for (;;) {
      operation.controller.signal.throwIfAborted();
      operation.record = { ...operation.record, status: "preparing" };
      this.emit();
      const fresh = await operation.port.prepare(
        approved,
        operation.controller.signal,
      );
      if (
        fresh.plan.id !== expected.id ||
        fresh.plan.targetId !== expected.targetId
      )
        throw new Error("Preflight cannot retarget an operation.");
      operation.controller.signal.throwIfAborted();
      if (sameMutationIntent(approved, fresh.plan)) return fresh;
      const confirmationPlan = freezeMutationPlan({
        ...fresh.plan,
        id: operation.record.plan.id,
        contextRevision: `${fresh.plan.contextRevision}:${randomUUID()}`,
      });
      const accepted = await new Promise<boolean>((resolve) => {
        operation.confirmation = {
          revision: confirmationPlan.contextRevision,
          resolve,
        };
        operation.record = {
          ...operation.record,
          plan: confirmationPlan,
          status: "awaiting-confirmation",
        };
        this.emit();
      });
      delete operation.confirmation;
      if (!accepted) {
        operation.controller.abort();
        operation.controller.signal.throwIfAborted();
      }
      approved = fresh.plan; // Read again: approval never authorizes a later, different context.
    }
  }
  private async execute(operation: ActiveOperation): Promise<MutationOutcome> {
    let plan = operation.record.plan;
    try {
      const prepared = await this.prepare(operation, plan);
      plan = prepared.plan;
      operation.record = { plan, status: "running", outcome: null };
      this.emit();
      let first = true;
      const outcome = await runMutation(
        plan,
        {
          execute: async (step) => {
            // Rebase the next edit against prior successful edits, never against their old text hashes.
            const fresh = first
              ? prepared
              : await this.prepare(operation, { ...plan, steps: [step] });
            first = false;
            const currentStep =
              fresh.plan.steps.find((item) => item.id === step.id) ??
              fresh.plan.steps[0];
            if (!currentStep) return [];
            plan = freezeMutationPlan({
              ...plan,
              steps: plan.steps.map((item) =>
                item.id === step.id ? { ...currentStep, id: step.id } : item,
              ),
            });
            operation.record = {
              ...operation.record,
              plan,
              status: "running",
              activeStepId: step.id,
            };
            this.emit();
            return fresh.execute(
              currentStep,
              () => operation.controller.signal.aborted,
            );
          },
          reconcile: async () => {
            operation.record = {
              ...operation.record,
              plan,
              status: "reconciling",
              activeStepId: null,
            };
            this.emit();
            await operation.port.reconcile(plan);
          },
        },
        () => operation.controller.signal.aborted,
        (progress) => {
          operation.record = { ...operation.record, progress };
          this.emit();
        },
      );
      this.finish(operation, outcome);
      return outcome;
    } catch (error) {
      let reconciliationError: string | null = null;
      operation.record = { ...operation.record, plan, status: "reconciling" };
      this.emit();
      try {
        await operation.port.reconcile(plan);
      } catch (failure) {
        reconciliationError =
          failure instanceof Error ? failure.message : "Reconciliation failed.";
      }
      const outcome: MutationOutcome = {
        operationId: plan.id,
        cancelled: operation.controller.signal.aborted,
        reconciliationError,
        steps: plan.steps.map((step) => ({
          stepId: step.id,
          status: "not-executed",
          error: operation.controller.signal.aborted
            ? null
            : error instanceof Error
              ? error.message
              : "Preflight failed.",
          changedPaths: [],
        })),
      };
      this.finish(operation, outcome);
      return outcome;
    }
  }
  private finish(operation: ActiveOperation, outcome: MutationOutcome): void {
    operation.record = {
      ...operation.record,
      outcome,
      status: outcome.cancelled
        ? "cancelled"
        : outcome.reconciliationError ||
            outcome.steps.some((step) => step.error)
          ? "failed"
          : "completed",
    };
    this.emit();
  }
  private emit(): void {
    const done = [...this.operations.values()].filter(
      (operation) => operation.record.outcome,
    );
    for (const operation of done.slice(0, Math.max(0, done.length - 20)))
      this.operations.delete(operation.record.plan.id);
    this.publish(
      [...this.operations.values()].map((operation) => operation.record),
    );
  }
}
