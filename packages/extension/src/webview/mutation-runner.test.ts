import { expect, it } from "vitest";
import type { MutationPlan } from "#contracts";
import { runMutation } from "./mutation-runner";
const plan: MutationPlan = {
  id: "batch",
  targetId: "solution",
  contextRevision: "r1",
  steps: ["1", "2", "3"].map((id) => ({
    id,
    kind: "package",
    projectPaths: [`/${id}.csproj`],
    packageId: "Demo",
    action: "update",
    version: "1.5.0",
    feedUrls: [],
  })),
};
it("stops at the first failure and reconciles without rolling back successful edits", async () => {
  const executed: string[] = [];
  const reconciled: string[] = [];
  const result = await runMutation(
    plan,
    {
      execute: async (step) => {
        executed.push(step.id);
        if (step.id === "2") throw new Error("restore failed");
        return ["/1.csproj"];
      },
      reconcile: async (current) => {
        reconciled.push(current.id);
      },
    },
    () => false,
  );
  expect(executed).toEqual(["1", "2"]);
  expect(reconciled).toEqual(["batch"]);
  expect(result.steps.map((step) => step.status)).toEqual([
    "completed",
    "failed",
    "not-executed",
  ]);
  expect(result.steps[0]?.changedPaths).toEqual(["/1.csproj"]);
});
it("waits for an active command and reports reconciliation failure independently", async () => {
  let cancelled = false;
  const result = await runMutation(
    plan,
    {
      execute: async () => {
        cancelled = true;
      },
      reconcile: async () => {
        throw new Error("inventory failed");
      },
    },
    () => cancelled,
  );
  expect(result.steps.map((step) => step.status)).toEqual([
    "completed",
    "not-executed",
    "not-executed",
  ]);
  expect(result.cancelled).toBe(true);
  expect(result.reconciliationError).toBe("inventory failed");
});
