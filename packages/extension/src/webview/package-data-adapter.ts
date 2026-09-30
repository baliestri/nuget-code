import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import type {
  InventorySnapshot,
  PackageFeed,
  PlannedCompatibilityEvidence,
  UpgradeCandidate,
  UpgradeContext,
  WorkspaceTarget,
} from "#contracts";
import {
  NuGetClient,
  evaluateProject,
  resolveDotnetSdk,
  prepareCompatibilityRequest,
  verifyPackageCompatibility,
  compatibilityRequestKey,
  CompatibilityQueue,
  type EvaluatedProject,
  type NuGetCli,
} from "#client";
import {
  pathKey,
  containsPath,
  verifyProjectInputs,
} from "#client/project-files";
import type { NuGetClientSettings, NuGetClientLogger } from "#client/types";
import { createPackageReferenceFingerprint } from "#extension/webview/package-fingerprint";
import type {
  CandidateVerification,
  PackageDataPort,
} from "#extension/webview/package-data-service";

export interface DataEnvironment {
  target: WorkspaceTarget | undefined;
  feeds: readonly PackageFeed[];
  configPaths: readonly string[];
  allowedRoots: readonly string[];
  settings: NuGetClientSettings;
  cli: NuGetCli;
  sourceRevision: string;
}
interface RecordSnapshot {
  snapshot: InventorySnapshot;
  environment: DataEnvironment;
  projects: Map<string, EvaluatedProject>;
  fingerprint: string;
}
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const refKey = (reference: {
  projectPath: string;
  framework: string;
  packageId: string;
  direct: boolean;
}) =>
  JSON.stringify([
    pathKey(reference.projectPath),
    reference.framework,
    reference.packageId.toLowerCase(),
    reference.direct,
  ]);

/** Host-only context registry. Full evaluation data and prepared plans never cross into the webview. */
export class PackageDataAdapter implements PackageDataPort {
  private readonly records = new Map<string, RecordSnapshot>();
  private readonly verifications =
    new CompatibilityQueue<PlannedCompatibilityEvidence>();
  constructor(
    private readonly capture: (targetId: string) => DataEnvironment,
    private readonly logger: NuGetClientLogger,
  ) {}
  async loadInventory(
    context: UpgradeContext,
    signal: AbortSignal,
  ): Promise<InventorySnapshot> {
    const environment = this.capture(context.targetId);
    const target = environment.target;
    if (!target) {
      const fingerprint = await createPackageReferenceFingerprint({
        target,
        centralPackageFiles: [],
        inputPaths: environment.configPaths,
      });
      signal.throwIfAborted();
      const snapshot: InventorySnapshot = {
        targetId: context.targetId,
        projectPaths: [],
        references: [],
        projectRevisions: {},
        inputPaths: [...environment.configPaths],
        revision: digest([
          context.targetId,
          environment.sourceRevision,
          fingerprint,
        ]),
      };
      this.records.set(snapshot.revision, {
        snapshot,
        environment,
        projects: new Map(),
        fingerprint,
      });
      while (this.records.size > 8)
        this.records.delete(this.records.keys().next().value!);
      return snapshot;
    }
    if (target.id !== context.targetId)
      throw new Error("The selected target is unavailable.");
    const projectPaths = [
      ...new Set(
        await Promise.all(
          (target.kind === "project" ? [target.path] : target.projectPaths).map(
            (file) => fs.realpath(file),
          ),
        ),
      ),
    ].sort();
    const roots = await Promise.all(
      environment.allowedRoots.map((root) => fs.realpath(root)),
    );
    const prior = [...this.records.values()].find(
      (record) => record.snapshot.targetId === context.targetId,
    );
    const initialInputs = [
      ...environment.configPaths,
      ...(prior?.snapshot.inputPaths ?? []),
    ];
    const before = await createPackageReferenceFingerprint({
      target,
      centralPackageFiles: [],
      inputPaths: initialInputs,
    });
    const projects = new Map<string, EvaluatedProject>();
    const evaluatedRoots = new Map<string, EvaluatedProject>();
    const inputs = new Set([...environment.configPaths, ...projectPaths]);
    const revisions: Record<string, string | null> = {};
    for (const projectPath of projectPaths) {
      signal.throwIfAborted();
      const root = roots
        .filter((candidate) => containsPath(candidate, projectPath))
        .sort((a, b) => a.length - b.length)[0];
      if (!root) {
        revisions[projectPath] = null;
        continue;
      }
      let evaluated = evaluatedRoots.get(pathKey(root));
      if (!evaluated) {
        try {
          // Multiple NuGet configs are not silently flattened: preserving their mappings belongs to a proven resolver.
          evaluated = await evaluateProject(
            environment.cli,
            {
              projectPath,
              allowedRoots: [root],
              feedUrls: environment.feeds
                .filter((feed) => feed.enabled && feed.id !== "__all__")
                .map((feed) => feed.url),
              sourceRevision: environment.sourceRevision,
              ...(environment.configPaths.length === 1
                ? { restoreConfigPath: environment.configPaths[0]! }
                : {}),
            },
            signal,
          );
          evaluatedRoots.set(pathKey(root), evaluated);
        } catch (error) {
          if (signal.aborted) throw error;
        }
      }
      if (evaluated) {
        for (const input of evaluated.inputs)
          if (input.kind !== "tool") inputs.add(input.path);
        projects.set(projectPath, evaluated);
      }
      revisions[projectPath] = evaluated?.isolation.supported
        ? evaluated.contextRevision
        : null;
    }
    const sdks: Record<string, string> = {};
    for (const project of projectPaths)
      sdks[project] =
        projects
          .get(project)
          ?.projects.find((node) => pathKey(node.path) === pathKey(project))
          ?.sdk.version ??
        (await resolveDotnetSdk(environment.cli, project, signal)).version;
    const listed = await NuGetClient.loadInstalledReferences({
      target: {
        ...target,
        path: target.kind === "project" ? projectPaths[0]! : target.path,
        projectPaths,
      },
      cli: environment.cli,
      logger: this.logger,
      signal,
      readOnly: true,
    });
    for (const project of projectPaths)
      if (
        sdks[project] !==
        (await resolveDotnetSdk(environment.cli, project, signal)).version
      )
        throw new Error("The project SDK changed during inventory loading.");
    const evaluatedReferences = new Map(
      [...evaluatedRoots.values()]
        .flatMap((project) => project.references)
        .map((reference) => [refKey(reference), reference]),
    );
    const references = listed.map((reference) => {
      const evaluated = evaluatedReferences.get(refKey(reference));
      if (
        evaluated &&
        (evaluated.requestedVersion !== reference.requestedVersion ||
          evaluated.resolvedVersion !== reference.resolvedVersion)
      )
        throw new Error("Package references changed during evaluation.");
      const result = {
        ...reference,
        declarationPath: evaluated?.declarationPath ?? null,
        affectedProjectPaths: evaluated?.affectedProjectPaths ?? [],
      };
      evaluatedReferences.delete(refKey(reference));
      return result;
    });
    references.push(
      ...[...evaluatedReferences.values()].filter(
        (reference) =>
          !projectPaths.some(
            (project) => pathKey(project) === pathKey(reference.projectPath),
          ),
      ),
    );
    references.sort((left, right) =>
      refKey(left) < refKey(right) ? -1 : refKey(left) > refKey(right) ? 1 : 0,
    );
    for (const project of evaluatedRoots.values())
      await verifyProjectInputs(project.inputs, project.directories, signal);
    if (
      before !==
        (await createPackageReferenceFingerprint({
          target,
          centralPackageFiles: [],
          inputPaths: initialInputs,
        })) ||
      environment.sourceRevision !==
        this.capture(context.targetId).sourceRevision
    )
      throw new Error("Inventory inputs changed during loading.");
    const inputPaths = [...inputs].sort();
    const fingerprint = await createPackageReferenceFingerprint({
      target,
      centralPackageFiles: [],
      inputPaths,
    });
    const snapshot: InventorySnapshot = {
      targetId: context.targetId,
      projectPaths,
      references,
      projectRevisions: revisions,
      inputPaths,
      revision: digest([
        context.targetId,
        projectPaths,
        fingerprint,
        sdks,
        revisions,
        references,
        environment.sourceRevision,
      ]),
    };
    signal.throwIfAborted();
    this.records.set(snapshot.revision, {
      snapshot,
      environment,
      projects,
      fingerprint,
    });
    while (this.records.size > 8)
      this.records.delete(this.records.keys().next().value!);
    return snapshot;
  }
  async loadCatalogs(
    snapshot: InventorySnapshot,
    context: UpgradeContext,
    signal: AbortSignal,
  ): Promise<Awaited<ReturnType<PackageDataPort["loadCatalogs"]>>> {
    const record = this.record(snapshot);
    const feeds = record.environment.feeds.filter((feed) =>
      context.feedUrls.includes(feed.url),
    );
    const names = [
      ...new Set(
        snapshot.references
          .filter(
            (reference) =>
              reference.direct &&
              snapshot.projectPaths.includes(reference.projectPath),
          )
          .map((reference) => reference.packageId.toLowerCase()),
      ),
    ];
    return Promise.all(
      names.map((packageId) =>
        NuGetClient.loadPackageCatalog({
          packageId,
          feeds,
          settings: record.environment.settings,
          logger: this.logger,
          signal,
        }),
      ),
    );
  }
  async verify(
    candidate: UpgradeCandidate,
    snapshot: InventorySnapshot,
    context: UpgradeContext,
    signal: AbortSignal,
  ): Promise<CandidateVerification> {
    const record = this.record(snapshot);
    const project = record.projects.get(candidate.projectPath);
    if (!project?.isolation.supported)
      return { kind: "unverified", reason: "project-context-unverified" };
    const current = async () =>
      record.environment.sourceRevision ===
        this.capture(context.targetId).sourceRevision &&
      record.fingerprint ===
        (await createPackageReferenceFingerprint({
          target: record.environment.target,
          centralPackageFiles: [],
          inputPaths: snapshot.inputPaths,
        }));
    if (!(await current()))
      return { kind: "unverified", reason: "snapshot-changed" };
    const request = await prepareCompatibilityRequest(
      {
        project,
        candidate,
        selectedProjectPaths: context.projectPaths,
        feedUrls: project.feedUrls,
      },
      signal,
    );
    const evidence = await this.verifications.request(
      compatibilityRequestKey(request),
      1,
      (sharedSignal) =>
        verifyPackageCompatibility(
          record.environment.cli,
          request,
          sharedSignal,
        ),
      signal,
    );
    if (!(await current()))
      return { kind: "unverified", reason: "snapshot-changed" };
    return { kind: "verified", request, evidence };
  }
  async search(query: string, context: UpgradeContext, signal: AbortSignal) {
    const environment = this.capture(context.targetId);
    let complete = true;
    const packages = await NuGetClient.searchPackages({
      feeds: environment.feeds.filter((feed) =>
        context.feedUrls.includes(feed.url),
      ),
      selectedFeedId: "__all__",
      query,
      includePrerelease: context.includePrerelease,
      settings: environment.settings,
      logger: this.logger,
      signal,
      onIncomplete: () => {
        complete = false;
      },
    });
    if (
      environment.sourceRevision !==
      this.capture(context.targetId).sourceRevision
    )
      throw new DOMException("Search context changed.", "AbortError");
    return { packages, complete };
  }
  dispose(): void {
    this.verifications.dispose();
    this.records.clear();
  }
  fingerprint(revision: string): string | undefined {
    return this.records.get(revision)?.fingerprint;
  }
  private record(snapshot: InventorySnapshot): RecordSnapshot {
    const record = this.records.get(snapshot.revision);
    if (!record) throw new Error("Inventory snapshot is no longer available.");
    return record;
  }
}
