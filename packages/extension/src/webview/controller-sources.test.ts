import { beforeEach, expect, it, vi } from "vitest";
import { createEmptyPackageManagerState } from "#manager";
import type {
  NuGetConfigFile,
  SourceDestination,
  SourceEditRequest,
} from "#contracts";
import { PackageManagerController } from "./controller";
import { MutationService } from "./mutation-service";
import { loadPackageSources } from "./source-loader";

vi.mock("./source-loader", () => ({ loadPackageSources: vi.fn() }));

const request: SourceEditRequest = {
  requestId: "save-42",
  sourceId: "__effective__",
  sourceRevision: "sources-v1",
  destinationId: "config",
  destinationRevision: "config-v1",
  edit: {
    action: "upsert",
    name: "Local",
    url: "./packages",
    enabled: true,
    allowInsecure: false,
  },
};
const destinations: SourceDestination[] = [
  {
    id: "config",
    path: "/workspace/NuGet.Config",
    label: "Workspace",
    revision: "config-v2",
  },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture() {
  const mutations = new MutationService(vi.fn());
  let suspended = false;
  const apply = vi.fn(async () => "/workspace/NuGet.Config");
  const describe = vi.fn(async () => destinations);
  const reloadSources = vi.fn(async () => {});
  const postState = vi.fn();
  const controller = Object.assign(
    Object.create(PackageManagerController.prototype) as {
      editSource(request: SourceEditRequest): Promise<void>;
      describeSourceEditor(reload?: boolean): Promise<void>;
    },
    {
      state: {
        ...createEmptyPackageManagerState(),
        selectedTargetId: "a",
        sourceEditor: { destinations, status: "idle" as const, message: "" },
      },
      settings: {},
      logger: {},
      sourceEditPending: false,
      sourceEditorRevision: 0,
      sourceEditor: { apply, describe },
      mutations,
      reloadSources,
      postState,
      packageReferenceWatcher: {
        suspendDuring: async (work: () => Promise<void>) => {
          suspended = true;
          try {
            await work();
          } finally {
            suspended = false;
          }
        },
      },
    },
  );
  return {
    controller,
    apply,
    describe,
    reloadSources,
    mutations,
    postState,
    suspended: () => suspended,
  };
}

beforeEach(() => {
  vi.mocked(loadPackageSources).mockReset().mockResolvedValue([]);
});

it("publishes the saved result with its request ID after reloading destinations", async () => {
  const test = fixture();
  await test.controller.editSource(request);
  expect(test.apply).toHaveBeenCalledWith(request, [], expect.any(Function));
  expect(test.reloadSources).toHaveBeenCalledOnce();
  expect(test.controller.state.sourceEditor).toMatchObject({
    status: "saved",
    requestId: "save-42",
    destinations,
  });
  expect(test.controller.state.sourceEditor.message).toContain(
    "/workspace/NuGet.Config",
  );
  expect(test.controller.sourceEditPending).toBe(false);
});

it("keeps the shared mutation slot and watcher suspension until reconciliation finishes", async () => {
  const test = fixture();
  const reloading = deferred<void>();
  test.reloadSources.mockImplementation(() => reloading.promise);
  const saving = test.controller.editSource(request);
  await vi.waitFor(() => expect(test.reloadSources).toHaveBeenCalledOnce());
  const nextWork = vi.fn(async () => {});
  const next = test.mutations.exclusive(nextWork);
  expect(test.suspended()).toBe(true);
  expect(nextWork).not.toHaveBeenCalled();
  expect(test.controller.state.sourceEditor.status).toBe("saving");
  reloading.resolve();
  await Promise.all([saving, next]);
  expect(nextWork).toHaveBeenCalledOnce();
  expect(test.suspended()).toBe(false);
});

it("preserves a meaningful save failure while reconciling partial editor changes", async () => {
  const test = fixture();
  test.apply.mockRejectedValue(
    new Error("Resolve unsaved changes before saving."),
  );
  await test.controller.editSource(request);
  expect(test.reloadSources).toHaveBeenCalledOnce();
  expect(test.controller.state.sourceEditor).toMatchObject({
    status: "failed",
    requestId: "save-42",
    message: "Resolve unsaved changes before saving.",
  });
  expect(test.suspended()).toBe(false);
});

it("does not overwrite a save failure if reconciliation also fails", async () => {
  const test = fixture();
  test.apply.mockRejectedValue(new Error("The destination changed."));
  test.reloadSources.mockRejectedValue(new Error("Reload failed"));
  await test.controller.editSource(request);
  expect(test.controller.state.sourceEditor.message).toContain(
    "The destination changed.",
  );
  expect(test.controller.state.sourceEditor.message).toContain(
    "Could not reload sources",
  );
  expect(test.controller.state.sourceEditor.status).toBe("failed");
});

it("rejects the edit if its context changes while source loading is pending", async () => {
  const test = fixture();
  const loading = deferred<NuGetConfigFile[]>();
  vi.mocked(loadPackageSources).mockReturnValueOnce(loading.promise);
  const saving = test.controller.editSource(request);
  await vi.waitFor(() => expect(loadPackageSources).toHaveBeenCalledOnce());
  test.controller.state = {
    ...test.controller.state,
    selectedTargetId: "b",
    sourceEditor: { destinations: [], status: "idle", message: "New target" },
  };
  loading.resolve([]);
  await saving;
  expect(test.apply).not.toHaveBeenCalled();
  expect(test.reloadSources).not.toHaveBeenCalled();
  expect(test.controller.state.sourceEditor.message).toBe("New target");
  expect(test.controller.sourceEditPending).toBe(false);
});

it("recovers from destination-description failure on a subsequent editor reload", async () => {
  const test = fixture();
  test.describe.mockRejectedValueOnce(new Error("Cannot read destination."));
  await test.controller.describeSourceEditor();
  expect(test.controller.state.sourceEditor).toMatchObject({
    status: "failed",
    message: "Cannot read destination.",
  });
  await test.controller.describeSourceEditor(true);
  expect(test.reloadSources).toHaveBeenCalledOnce();
  expect(test.controller.state.sourceEditor).toEqual({
    destinations,
    status: "idle",
    message: "",
  });
});

it("reports destination reload failure after saving without claiming complete success", async () => {
  const test = fixture();
  test.describe.mockRejectedValueOnce(new Error("Cannot read destination."));
  await test.controller.editSource(request);
  expect(test.controller.state.sourceEditor).toMatchObject({
    status: "failed",
    requestId: "save-42",
    destinations: [],
  });
  expect(test.controller.state.sourceEditor.message).toContain(
    "Saved /workspace/NuGet.Config",
  );
  expect(test.controller.state.sourceEditor.message).toContain(
    "Could not reload destinations",
  );
});

it("ignores a duplicate save while the first request is still loading sources", async () => {
  const test = fixture();
  const loading = deferred<NuGetConfigFile[]>();
  vi.mocked(loadPackageSources).mockReturnValueOnce(loading.promise);
  const saving = test.controller.editSource(request);
  await vi.waitFor(() => expect(loadPackageSources).toHaveBeenCalledOnce());
  await test.controller.editSource({ ...request, requestId: "duplicate" });
  loading.resolve([]);
  await saving;
  expect(test.apply).toHaveBeenCalledOnce();
  expect(test.controller.state.sourceEditor).toMatchObject({
    status: "saved",
    requestId: "save-42",
  });
});

it("discards an older describe response when a newer editor request completes first", async () => {
  const test = fixture();
  const firstDescription = deferred<SourceDestination[]>();
  test.describe.mockReturnValueOnce(firstDescription.promise);
  const obsolete = test.controller.describeSourceEditor();
  await test.controller.describeSourceEditor();
  firstDescription.resolve([{ ...destinations[0]!, revision: "obsolete" }]);
  await obsolete;
  expect(test.controller.state.sourceEditor).toEqual({
    destinations,
    status: "idle",
    message: "",
  });
});
