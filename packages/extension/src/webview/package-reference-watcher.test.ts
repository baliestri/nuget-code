import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { PackageReferenceWatcher } from "./package-reference-watcher.js";

const vscodeMock = vscode as typeof vscode & {
  __resetVscodeMock(): void;
};

function setup() {
  let fingerprint = "fp-1";
  const createFingerprint = vi.fn().mockResolvedValue("fp-2");
  const refreshPackages = vi.fn().mockResolvedValue(undefined);
  const refreshDiscovery = vi.fn().mockResolvedValue(undefined);

  const watcher = new PackageReferenceWatcher(
    { information: vi.fn(), verbose: vi.fn() } as never,
    createFingerprint,
    () => fingerprint,
    (fp) => {
      fingerprint = fp;
    },
    refreshPackages,
    refreshDiscovery,
  );

  watcher.register();

  const created = vi.mocked(vscode.workspace.createFileSystemWatcher).mock
    .results;
  const [projectWatcher, solutionWatcher, centralPackageWatcher] = created.map(
    (result) => result.value,
  );

  return {
    watcher,
    createFingerprint,
    refreshPackages,
    refreshDiscovery,
    projectWatcher,
    solutionWatcher,
    centralPackageWatcher,
  };
}

describe("PackageReferenceWatcher", () => {
  beforeEach(() => {
    vscodeMock.__resetVscodeMock();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces a project onDidCreate into refreshDiscovery, not the fingerprint path", async () => {
    const {
      projectWatcher,
      refreshDiscovery,
      refreshPackages,
      createFingerprint,
    } = setup();

    projectWatcher.onDidCreate.mock.calls[0][0]();
    await vi.advanceTimersByTimeAsync(750);

    expect(refreshDiscovery).toHaveBeenCalledTimes(1);
    expect(createFingerprint).not.toHaveBeenCalled();
    expect(refreshPackages).not.toHaveBeenCalled();
  });

  it("debounces a project onDidDelete into refreshDiscovery", async () => {
    const { projectWatcher, refreshDiscovery } = setup();

    projectWatcher.onDidDelete.mock.calls[0][0]();
    await vi.advanceTimersByTimeAsync(750);

    expect(refreshDiscovery).toHaveBeenCalledTimes(1);
  });

  it("debounces a solution onDidCreate into refreshDiscovery", async () => {
    const { solutionWatcher, refreshDiscovery } = setup();

    solutionWatcher.onDidCreate.mock.calls[0][0]();
    await vi.advanceTimersByTimeAsync(750);

    expect(refreshDiscovery).toHaveBeenCalledTimes(1);
  });

  it("debounces a solution onDidDelete into refreshDiscovery", async () => {
    const { solutionWatcher, refreshDiscovery } = setup();

    solutionWatcher.onDidDelete.mock.calls[0][0]();
    await vi.advanceTimersByTimeAsync(750);

    expect(refreshDiscovery).toHaveBeenCalledTimes(1);
  });

  it("still runs the fingerprint-only path for a content-only project change", async () => {
    const {
      projectWatcher,
      refreshDiscovery,
      refreshPackages,
      createFingerprint,
    } = setup();

    projectWatcher.onDidChange.mock.calls[0][0]();
    await vi.advanceTimersByTimeAsync(750);

    expect(createFingerprint).toHaveBeenCalledTimes(1);
    expect(refreshPackages).toHaveBeenCalledWith({ forceInventory: true });
    expect(refreshDiscovery).not.toHaveBeenCalled();
  });

  it("skips refreshPackages when the fingerprint is unchanged", async () => {
    const refreshPackages = vi.fn().mockResolvedValue(undefined);
    const watcher = new PackageReferenceWatcher(
      { information: vi.fn(), verbose: vi.fn() } as never,
      vi.fn().mockResolvedValue("same"),
      () => "same",
      vi.fn(),
      refreshPackages,
      vi.fn().mockResolvedValue(undefined),
    );
    watcher.register();
    const [projectWatcher] = vi
      .mocked(vscode.workspace.createFileSystemWatcher)
      .mock.results.map((result) => result.value);

    projectWatcher.onDidChange.mock.calls[0][0]();
    await vi.advanceTimersByTimeAsync(750);

    expect(refreshPackages).not.toHaveBeenCalled();
  });

  it("collapses a burst mixing a content change and a structural create into a single refreshDiscovery call", async () => {
    const { projectWatcher, refreshDiscovery, refreshPackages } = setup();

    projectWatcher.onDidChange.mock.calls[0][0]();
    await vi.advanceTimersByTimeAsync(300);
    projectWatcher.onDidCreate.mock.calls[0][0]();
    await vi.advanceTimersByTimeAsync(750);

    expect(refreshDiscovery).toHaveBeenCalledTimes(1);
    expect(refreshPackages).not.toHaveBeenCalled();
  });

  it("resets the 750ms debounce timer on repeated events", async () => {
    const { projectWatcher, refreshDiscovery } = setup();

    projectWatcher.onDidCreate.mock.calls[0][0]();
    await vi.advanceTimersByTimeAsync(600);
    projectWatcher.onDidCreate.mock.calls[0][0]();
    await vi.advanceTimersByTimeAsync(600);

    expect(refreshDiscovery).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(150);

    expect(refreshDiscovery).toHaveBeenCalledTimes(1);
  });

  it("watches Directory.Packages.props on create/change/delete via the fingerprint-only path", async () => {
    const { centralPackageWatcher, refreshDiscovery, refreshPackages } =
      setup();

    centralPackageWatcher.onDidCreate.mock.calls[0][0]();
    await vi.advanceTimersByTimeAsync(750);
    expect(refreshDiscovery).not.toHaveBeenCalled();
    expect(refreshPackages).toHaveBeenCalledWith({ forceInventory: true });
  });

  it("clears the debounce timer and disposes all watchers on dispose()", async () => {
    const {
      watcher,
      projectWatcher,
      solutionWatcher,
      centralPackageWatcher,
      refreshDiscovery,
    } = setup();

    projectWatcher.onDidCreate.mock.calls[0][0]();
    watcher.dispose();
    await vi.advanceTimersByTimeAsync(750);

    expect(refreshDiscovery).not.toHaveBeenCalled();
    expect(projectWatcher.dispose).toHaveBeenCalledTimes(1);
    expect(solutionWatcher.dispose).toHaveBeenCalledTimes(1);
    expect(centralPackageWatcher.dispose).toHaveBeenCalledTimes(1);
  });
});
