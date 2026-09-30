import { expect, it, vi } from "vitest";
import { ClientNetwork } from "#client";
import { createEmptyPackageManagerState } from "#manager";
import { PackageManagerController } from "./controller";
import { ReadCoordinator } from "./read-coordinator";

function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// Exercise the controller's orchestration with controlled service boundaries, without a VS Code UI.
function fixture() {
  const fingerprint = gate<string>();
  const inventoryStarted = gate<AbortSignal>();
  const inventoryDone = gate<void>();
  const network = new ClientNetwork();
  const reads = new ReadCoordinator();
  const inventory = vi.fn(async (_id: number, signal: AbortSignal) => {
    inventoryStarted.resolve(signal);
    await inventoryDone.promise;
  });
  const controller = Object.assign(
    Object.create(PackageManagerController.prototype) as {
      refreshPackages(): Promise<void>;
      refreshAvailablePackages(): Promise<void>;
      cancelPackageReads(): void;
    },
    {
      state: { ...createEmptyPackageManagerState(), selectedTargetId: "a" },
      settings: {},
      network,
      reads,
      packageReferenceFingerprint: "",
      availablePackagesRequestId: 0,
      packageInventoryRequestId: 0,
      packageAvailabilityRequestId: 0,
      packageCache: { read: vi.fn(async () => undefined) },
      createPackageReferenceFingerprint: () => fingerprint.promise,
      refreshAvailablePackagesForRequest: vi.fn(async () => {}),
      refreshPackageInventoryForRequest: inventory,
    },
  );
  return {
    controller,
    fingerprint,
    inventoryStarted,
    inventoryDone,
    inventory,
    dispose: () => {
      reads.dispose();
      network.dispose();
    },
  };
}

it("does not discard or abort initial inventory when search changes during cache/fingerprint loading", async () => {
  const test = fixture();
  try {
    const initial = test.controller.refreshPackages();
    test.controller.state = { ...test.controller.state, search: "new query" };
    await test.controller.refreshAvailablePackages();
    test.fingerprint.resolve("inputs");
    const signal = await test.inventoryStarted.promise;
    expect(signal.aborted).toBe(false);
    test.controller.state = {
      ...test.controller.state,
      search: "another query",
    };
    await test.controller.refreshAvailablePackages();
    expect(signal.aborted).toBe(false);
    expect(test.inventory).toHaveBeenCalledOnce();
    test.controller.cancelPackageReads();
    expect(signal.aborted).toBe(true);
    test.inventoryDone.resolve();
    await initial;
  } finally {
    test.inventoryDone.resolve();
    test.dispose();
  }
});

it("does not start inventory for an obsolete target after a delayed fingerprint resolves", async () => {
  const test = fixture();
  try {
    const initial = test.controller.refreshPackages();
    test.controller.cancelPackageReads();
    test.controller.state = { ...test.controller.state, selectedTargetId: "b" };
    test.fingerprint.resolve("old inputs");
    await initial;
    expect(test.inventory).not.toHaveBeenCalled();
    expect(
      test.controller.refreshAvailablePackagesForRequest,
    ).not.toHaveBeenCalled();
  } finally {
    test.dispose();
  }
});
