import { expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { CompatibilityRequest } from "#client";
import type {
  InventorySnapshot,
  UpdateProjection,
  UpgradeContext,
} from "#contracts";
import {
  PackageDataService,
  type PackageDataPort,
} from "./package-data-service";

const context: UpgradeContext = {
  targetId: "a",
  projectPaths: ["/a.csproj"],
  feedUrls: ["https://feed.test"],
  includePrerelease: true,
  revision: "sources-1",
};
const snapshot: InventorySnapshot = {
  targetId: "a",
  projectPaths: ["/a.csproj"],
  revision: "snapshot-1",
  inputPaths: ["/a.csproj"],
  projectRevisions: { "/a.csproj": "project-1" },
  references: [
    {
      referenceId: "ref",
      packageId: "Demo",
      projectPath: "/a.csproj",
      framework: "net8.0",
      requestedVersion: "1.0.0",
      resolvedVersion: "1.0.0",
      direct: true,
      declarationPath: "/a.csproj",
      affectedProjectPaths: ["/a.csproj"],
    },
  ],
};
const catalog = {
  packageId: "Demo",
  complete: true,
  revision: "catalog",
  versions: ["1.5.0", "2.0.0-beta"].map((version) => ({
    version,
    listed: true,
    feedUrls: context.feedUrls,
  })),
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup(overrides: Partial<PackageDataPort> = {}) {
  const published: UpdateProjection[] = [];
  const flows = vi.fn();
  const port: PackageDataPort = {
    loadInventory: vi.fn(async () => snapshot),
    loadCatalogs: vi.fn(async () => [catalog]),
    verify: vi.fn(async () => ({
      kind: "unverified" as const,
      reason: "not-supported",
    })),
    ...overrides,
  };
  const service = new PackageDataService(
    port,
    (value) => published.push(value),
    { flow: flows },
  );
  service.setContext(context);
  return { service, port, published, flows };
}
it("immediately excludes preview and ignores a pending verification from the old filter", async () => {
  const verification =
    deferred<Awaited<ReturnType<PackageDataPort["verify"]>>>();
  const test = setup({ verify: vi.fn(() => verification.promise) });
  await test.service.refresh({ force: false });
  expect(test.published.at(-1)?.evaluation.candidates[0]?.version).toBe(
    "2.0.0-beta",
  );
  const start = test.published.length;
  test.service.setContext({ ...context, includePrerelease: false });
  verification.resolve({ kind: "unverified", reason: "late" });
  await Promise.resolve();
  await Promise.resolve();
  expect(
    test.published
      .slice(start)
      .every((value) =>
        value.evaluation.candidates.every(
          (candidate) => !candidate.version.includes("-"),
        ),
      ),
  ).toBe(true);
  expect(test.published.at(-1)?.evaluation.candidates[0]?.version).toBe(
    "1.5.0",
  );
  expect(test.port.loadInventory).toHaveBeenCalledOnce();
  test.service.dispose();
});
it("does not publish inventory from an obsolete target even when the port ignores cancellation", async () => {
  const load = deferred<InventorySnapshot>();
  const test = setup({ loadInventory: vi.fn(() => load.promise) });
  const refresh = test.service.refresh({ force: false });
  test.service.setContext({
    ...context,
    targetId: "b",
    projectPaths: ["/b.csproj"],
  });
  const start = test.published.length;
  load.resolve(snapshot);
  await refresh;
  expect(
    test.published
      .slice(start)
      .every(
        (value) =>
          value.context.targetId === "b" &&
          value.evaluation.candidates.length === 0,
      ),
  ).toBe(true);
  expect(test.port.loadCatalogs).not.toHaveBeenCalled();
  test.service.dispose();
});
it("finishes current loading on failure and preserves incomplete-source status", async () => {
  const test = setup({
    loadCatalogs: vi.fn(async () => [{ ...catalog, complete: false }]),
  });
  await test.service.refresh({ force: true });
  expect(test.flows).toHaveBeenCalledWith(
    "catalog",
    expect.objectContaining({ status: "failed" }),
  );
  expect(
    test.published.at(-1)?.evaluation.candidates[0]?.compatibility.status,
  ).toBe("unverified");
  expect(test.port.verify).not.toHaveBeenCalled();
  test.service.dispose();
});

it("retains the exact native project proof separately from the selection revision", async () => {
  let request!: CompatibilityRequest;
  const test = setup({
    verify: async (candidate, inventory, selection) => {
      const plan = { contextRevision: "project-1", changes: [], files: [] };
      request = {
        candidate,
        project: {
          contextRevision: "project-1",
        } as CompatibilityRequest["project"],
        plan,
        planRevision: createHash("sha256")
          .update(JSON.stringify(plan))
          .digest("hex"),
        selectedProjectPaths: selection.projectPaths,
        feedUrls: selection.feedUrls,
      };
      expect(inventory.revision).toBe("snapshot-1");
      return {
        kind: "verified",
        request,
        evidence: {
          candidateKey: candidate.key,
          planRevision: request.planRevision,
          contextRevision: "project-1",
          result: { status: "compatible", diagnostics: [] },
        },
      };
    },
  });
  await test.service.refresh({ force: false });
  await Promise.resolve();
  const projection = test.published.at(-1)!;
  expect(projection.context.revision).not.toBe("project-1");
  const key = projection.evaluation.candidates[0]!.key;
  expect(test.service.getVerifiedRequest(key)).toBe(request);
  expect(
    test.service.getVerifiedCandidate(key)?.verification.evidence
      .contextRevision,
  ).toBe("project-1");
  expect(test.service.getVerifiedCandidate(key)?.selectionRevision).toBe(
    projection.context.revision,
  );
  expect(request.plan.contextRevision).toBe("project-1");
  test.service.invalidate("a");
  expect(test.service.getVerifiedRequest(key)).toBeUndefined();
  test.service.dispose();
});

it("does not re-enable cached candidates after a failed forced inventory refresh", async () => {
  const test = setup();
  await test.service.refresh({ force: false });
  vi.mocked(test.port.loadInventory).mockRejectedValueOnce(
    new Error("failure"),
  );
  vi.mocked(test.port.loadCatalogs).mockClear();
  await test.service.refresh({ force: true });
  expect(test.port.loadCatalogs).not.toHaveBeenCalled();
  expect(test.flows).toHaveBeenCalledWith(
    "inventory",
    expect.objectContaining({ status: "failed", stale: true }),
  );
  expect(
    test.published
      .at(-1)
      ?.evaluation.candidates.every(
        (candidate) => candidate.compatibility.status !== "compatible",
      ),
  ).toBe(true);
  test.service.dispose();
});

it("an old finally cannot finish the replacement inventory flow", async () => {
  const first = deferred<InventorySnapshot>();
  const second = deferred<InventorySnapshot>();
  const test = setup({
    loadInventory: vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise),
  });
  const old = test.service.refresh({ force: true });
  const latest = test.service.refresh({ force: true });
  test.flows.mockClear();
  first.resolve(snapshot);
  await old;
  expect(test.flows).not.toHaveBeenCalledWith(
    "inventory",
    expect.objectContaining({ status: "ready" }),
  );
  second.resolve({ ...snapshot, revision: "new" });
  await latest;
  expect(test.flows).toHaveBeenCalledWith(
    "inventory",
    expect.objectContaining({ status: "ready" }),
  );
  test.service.dispose();
});

it("rejects proof carrying the selection revision instead of the native project revision", async () => {
  const test = setup({
    verify: async (candidate, _inventory, selection) => {
      const plan = { contextRevision: "project-1", changes: [], files: [] };
      const planRevision = createHash("sha256")
        .update(JSON.stringify(plan))
        .digest("hex");
      return {
        kind: "verified",
        request: {
          candidate,
          project: {
            contextRevision: "project-1",
          } as CompatibilityRequest["project"],
          plan,
          planRevision,
          selectedProjectPaths: selection.projectPaths,
          feedUrls: selection.feedUrls,
        },
        evidence: {
          candidateKey: candidate.key,
          contextRevision: selection.revision,
          planRevision,
          result: { status: "compatible", diagnostics: [] },
        },
      };
    },
  });
  await test.service.refresh({ force: false });
  await Promise.resolve();
  const candidate = test.published.at(-1)!.evaluation.candidates[0]!;
  expect(candidate.compatibility).toMatchObject({
    status: "unverified",
    reason: "evidence-mismatch",
  });
  expect(test.service.getVerifiedRequest(candidate.key)).toBeUndefined();
  test.service.dispose();
});
