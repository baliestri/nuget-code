import { expect, it, vi } from "vitest";
import { createEmptyPackageManagerState } from "#manager";
import type { InventorySnapshot } from "#contracts";
import { PackageManagerController } from "./controller";
import {
  PackageDataService,
  type PackageDataPort,
} from "./package-data-service";

function fixture() {
  let release!: (snapshot: InventorySnapshot) => void;
  const gate = new Promise<InventorySnapshot>((resolve) => {
    release = resolve;
  });
  let signal!: AbortSignal;
  const inventory = vi.fn(async (_context, value) => {
    signal = value;
    return gate;
  }) as PackageDataPort["loadInventory"];
  const search = vi.fn(async () => ({ packages: [], complete: true }));
  const published = vi.fn();
  const service = new PackageDataService(
    {
      loadInventory: inventory,
      loadCatalogs: async () => [],
      verify: async () => ({ kind: "unverified", reason: "test" }),
      search,
    },
    published,
  );
  const controller = Object.assign(
    Object.create(PackageManagerController.prototype) as {
      refreshPackages(): Promise<void>;
      refreshAvailablePackages(): Promise<void>;
      cancelPackageReads(): void;
    },
    {
      state: { ...createEmptyPackageManagerState(), selectedTargetId: "a" },
      data: service,
      packageDetails: { cancel: vi.fn() },
      logger: { warning: vi.fn() },
      syncDataContext: () =>
        service.setContext({
          targetId: controller.state.selectedTargetId,
          projectPaths: [`/${controller.state.selectedTargetId}.csproj`],
          feedUrls: [],
          includePrerelease: false,
          revision: "sources",
        }),
    },
  );
  const snapshot: InventorySnapshot = {
    targetId: "a",
    projectPaths: ["/a.csproj"],
    revision: "inputs",
    references: [],
    projectRevisions: {},
    inputPaths: [],
  };
  return {
    controller,
    inventory,
    search,
    published,
    signal: () => signal,
    release: () => release(snapshot),
    dispose: () => service.dispose(),
  };
}

it("search stays available while initial inventory is pending and never aborts that read", async () => {
  const test = fixture();
  try {
    const initial = test.controller.refreshPackages();
    test.controller.state = { ...test.controller.state, search: "new query" };
    await test.controller.refreshAvailablePackages();
    expect(test.signal().aborted).toBe(false);
    expect(test.inventory).toHaveBeenCalledOnce();
    expect(test.search).toHaveBeenCalledTimes(2);
    test.release();
    await initial;
  } finally {
    test.release();
    test.dispose();
  }
});
it("rejects obsolete inventory when target changes while the adapter ignores cancellation", async () => {
  const test = fixture();
  try {
    const initial = test.controller.refreshPackages();
    test.controller.cancelPackageReads();
    test.controller.state = { ...test.controller.state, selectedTargetId: "b" };
    test.controller.syncDataContext();
    expect(test.signal().aborted).toBe(true);
    test.published.mockClear();
    test.release();
    await initial;
    expect(
      test.published.mock.calls.every(
        ([projection]) => projection.context.targetId === "b",
      ),
    ).toBe(true);
  } finally {
    test.dispose();
  }
});
