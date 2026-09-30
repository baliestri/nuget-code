import { normalizeCatalogFeedUrl } from "#manager";
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
import { networkFor } from "#client/client-network";
import { createPackageReferenceFingerprint } from "#extension/webview/package-fingerprint";
import { resolveProjectSdkSnapshot } from "#extension/webview/project-sdk-snapshot";
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
  generation: number;
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
    force = false,
  ): Promise<InventorySnapshot> {
    const environment = this.capture(context.targetId);
    const network = networkFor(environment.settings);
    const generation = force ? network.refresh() : network.facts.generation;
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
        generation,
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
    this.logger.information(
      "nuget.packages",
      `Loading inventory for ${target.name}: ${projectPaths.length} project(s).`,
    );
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
    const sdkSelection = await resolveProjectSdkSnapshot(
      environment.cli,
      projectPaths,
      roots,
      environment.settings.dotnetPath,
      signal,
      this.logger,
    );
    const sdks = Object.fromEntries(
      [...sdkSelection.sdks].map(([file, sdk]) => [file, sdk.version]),
    );
    for (const file of sdkSelection.inputPaths) inputs.add(file);
    for (const file of projectPaths) {
      const evaluated = projects
        .get(file)
        ?.projects.find((node) => pathKey(node.path) === pathKey(file));
      if (evaluated && evaluated.sdk.version !== sdks[file])
        throw new Error("The SDK changed after project evaluation.");
    }
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
      resolvedSdks: sdkSelection.sdks,
    });
    await sdkSelection.revalidate();
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
    const verifiedProjects = Object.values(revisions).filter(Boolean).length;
    this.logger.information(
      "nuget.packages",
      `Inventory ready for ${target.name}: ${projectPaths.length} project(s), ${listed.length} reference(s); ${verifiedProjects} project context(s) available for automatic verification.`,
    );
    this.records.set(snapshot.revision, {
      generation,
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
    force = false,
  ): Promise<Awaited<ReturnType<PackageDataPort["loadCatalogs"]>>> {
    const record = this.record(snapshot);
    const network = networkFor(record.environment.settings);
    const generation = force ? record.generation : network.facts.generation;
    const feeds = record.environment.feeds.filter((feed) =>
      context.feedUrls.includes(normalizeCatalogFeedUrl(feed.url) ?? feed.url),
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
          generation,
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
        context.feedUrls.includes(
          normalizeCatalogFeedUrl(feed.url) ?? feed.url,
        ),
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
  evaluation(
    revision: string,
    projectPath: string,
  ): EvaluatedProject | undefined {
    return this.records.get(revision)?.projects.get(projectPath);
  }
  private record(snapshot: InventorySnapshot): RecordSnapshot {
    const record = this.records.get(snapshot.revision);
    if (!record) throw new Error("Inventory snapshot is no longer available.");
    return record;
  }
}
