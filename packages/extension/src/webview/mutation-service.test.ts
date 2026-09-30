import { expect, it, vi } from "vitest";
import type { MutationPlan } from "#contracts";
import { MutationService } from "./mutation-service";
const plan: MutationPlan = {
  id: "op",
  targetId: "fixed",
  contextRevision: "r",
  steps: [
    {
      id: "step",
      kind: "package",
      packageId: "Demo",
      action: "update",
      projectPaths: ["/a"],
      version: "1.5.0",
      feedUrls: ["feed"],
    },
  ],
};
function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
it("rejects old confirmations and rechecks a plan changed while the user reviewed it", async () => {
  const first = gate<MutationPlan>();
  const second = gate<MutationPlan>();
  const seen = new Set<string>();
  const service = new MutationService((records) => {
    const record = records.at(-1)!;
    if (
      record.status === "awaiting-confirmation" &&
      !seen.has(record.plan.contextRevision)
    ) {
      seen.add(record.plan.contextRevision);
      (seen.size === 1 ? first : second).resolve(record.plan);
    }
  });
  let version = "2.0.0";
  const execute = vi.fn(async () => []);
  const reconcile = vi.fn(async () => {});
  const operation = service.submit(plan, {
    prepare: async (input) => ({
      plan: {
        ...input,
        contextRevision: version,
        steps: input.steps.map((step) => ({ ...step, version })),
      },
      execute,
    }),
    reconcile,
  });
  const a = await first.promise;
  expect(service.confirm("op", "wrong", true)).toBe(false);
  version = "3.0.0";
  expect(service.confirm("op", a.contextRevision, true)).toBe(true);
  const b = await second.promise;
  expect(service.confirm("op", a.contextRevision, true)).toBe(false);
  expect(service.confirm("op", b.contextRevision, true)).toBe(true);
  const outcome = await operation;
  expect(execute).toHaveBeenCalledWith(
    expect.objectContaining({ version: "3.0.0", projectPaths: ["/a"] }),
    expect.any(Function),
  );
  expect(outcome.steps[0]?.status).toBe("completed");
  expect(reconcile).toHaveBeenCalledOnce();
  service.dispose();
});
it("keeps active cancellation separate from the command and reconciles before the next job", async () => {
  const active = gate<void>();
  const started = gate<void>();
  const order: string[] = [];
  const service = new MutationService(() => {});
  const a = service.submit(plan, {
    prepare: async (input) => ({
      plan: input,
      execute: async () => {
        order.push("command");
        started.resolve();
        await active.promise;
        order.push("command closed");
      },
    }),
    reconcile: async () => {
      order.push("reconcile");
    },
  });
  await started.promise;
  service.cancel("op");
  const b = service.submit(
    { ...plan, id: "next" },
    {
      prepare: async (input) => {
        order.push("next");
        return { plan: input, execute: async () => {} };
      },
      reconcile: async () => {},
    },
  );
  expect(order).toEqual(["command"]);
  active.resolve();
  await Promise.all([a, b]);
  expect(order).toEqual(["command", "command closed", "reconcile", "next"]);
  service.dispose();
});
