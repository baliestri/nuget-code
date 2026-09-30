import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { workspace } from "vscode";
import type {
  MutationPlan,
  MutationStep,
  UpgradeContext,
  UpgradeCandidate,
  VersionDeclarationChange,
  PackageVersionEditPlan,
} from "#contracts";
import {
  NuGetClient,
  applyVersionEditPlan,
  createVersionEditPlan,
  dotnetArguments,
  resolveDotnetSdk,
  type EvaluatedProject,
} from "#client";
import { isolatedConfig } from "#client/compatibility-sandbox";
import {
  restrictCompatibilitySources,
  sourceIdentity,
} from "#client/compatibility-sources";
import {
  containsPath,
  contentHash,
  decodeProjectText,
  pathKey,
  readScopedFile,
  verifyProjectInputs,
} from "#client/project-files";
import {
  candidateKey,
  evaluateUpgrades,
  freezeMutationPlan,
  sameNuGetVersion,
  compareNuGetVersions,
  parseNuGetVersion,
} from "#manager";
import {
  PackageDataAdapter,
  type DataEnvironment,
} from "#extension/webview/package-data-adapter";
import type {
  OperationPort,
  PreparedMutation,
} from "#extension/webview/mutation-service";
import {
  createVersionEditIO,
  type EditorPort,
} from "#extension/webview/version-edit-io";
import type { NuGetClientLogger } from "#client/types";

export interface PackageMutationIntent {
  context: UpgradeContext;
  environment: DataEnvironment;
  automatic: boolean;
}
interface Binding {
  step: MutationStep;
  project?: EvaluatedProject;
  edit?: PackageVersionEditPlan;
}
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** The target and project set are captured once; live settings may invalidate, never retarget, that intent. */
export class PackageMutationPort implements OperationPort {
  constructor(
    private readonly intent: PackageMutationIntent,
    private readonly live: () => DataEnvironment,
    private readonly logger: NuGetClientLogger,
    private readonly reconcileFacts: (
      environment: DataEnvironment,
    ) => Promise<void>,
    private readonly editor?: EditorPort,
  ) {}
  async prepare(
    plan: MutationPlan,
    signal: AbortSignal,
  ): Promise<PreparedMutation> {
    signal.throwIfAborted();
    const live = this.live();
    const projects = await Promise.all(
      this.intent.context.projectPaths.map((file) => fs.realpath(file)),
    );
    const roots = await Promise.all(
      live.allowedRoots.map((root) => fs.realpath(root)),
    );
    if (
      projects.some((file) => !roots.some((root) => containsPath(root, file)))
    )
      throw new Error(
        "The operation's projects are no longer in the authorized workspace.",
      );
    const target = this.intent.environment.target;
    if (!target) throw new Error("The operation has no fixed target.");
    const environment: DataEnvironment = {
      ...live,
      target: {
        ...target,
        projectPaths: projects,
        path: target.kind === "project" ? projects[0]! : target.path,
      },
    };
    const context = {
      ...this.intent.context,
      projectPaths: projects,
      revision: environment.sourceRevision,
    };
    if (plan.steps.every((step) => step.kind === "restore")) {
      const steps = await Promise.all(
        plan.steps.map(async (step) => ({
          ...step,
          projectPaths: await Promise.all(
            step.projectPaths.map((file) => fs.realpath(file)),
          ),
        })),
      );
      const fixed = freezeMutationPlan({
        ...plan,
        contextRevision: hash([environment.sourceRevision, projects]),
        steps,
      });
      return {
        plan: fixed,
        execute: async (step) => {
          for (const file of step.projectPaths) {
            if (!projects.includes(file))
              throw new Error("Restore target is outside the fixed selection.");
            await resolveDotnetSdk(environment.cli, file);
            const result = await environment.cli.runDotnet(
              ["restore", file],
              path.dirname(file),
              { privateDiagnostics: true },
            );
            if (result.code !== 0)
              throw new Error(`Restore failed for ${path.basename(file)}.`);
          }
        },
      };
    }
    const adapter = new PackageDataAdapter(() => environment, this.logger);
    try {
      const snapshot = await adapter.loadInventory(context, signal, true);
      this.assertClean(snapshot.inputPaths);
      const catalogs = this.intent.automatic
        ? await adapter.loadCatalogs(snapshot, context, signal)
        : [];
      const bindings: Binding[] = [];
      const seen = new Set<string>();
      for (const requested of plan.steps) {
        signal.throwIfAborted();
        if (!requested.packageId || requested.kind !== "package")
          throw new Error("Unsupported package operation.");
        if (
          requested.action !== "remove" &&
          (!requested.version || !parseNuGetVersion(requested.version))
        )
          throw new Error("Select a concrete NuGet version.");
        const allowedFeeds = environment.feeds.filter(
          (feed) =>
            feed.enabled &&
            requested.feedUrls.some(
              (url) => sourceIdentity(url) === sourceIdentity(feed.url),
            ),
        );
        if (requested.action !== "remove" && !allowedFeeds.length)
          throw new Error(
            "The selected package sources changed; prepare a new operation.",
          );
        const canonical = await Promise.all(
          requested.projectPaths.map((file) => fs.realpath(file)),
        );
        const selected = canonical.map(
          (file) =>
            snapshot.projectPaths.find(
              (known) => pathKey(file) === pathKey(known),
            ) ?? "",
        );
        if (selected.some((file) => !file))
          throw new Error(
            "A requested project is outside the fixed selection.",
          );
        if (this.intent.automatic) {
          const evidence = new Map();
          let bound = false;
          for (;;) {
            const evaluation = evaluateUpgrades({
              inventory: snapshot.references,
              catalogs,
              context: {
                ...context,
                projectPaths: snapshot.projectPaths,
                feedUrls: allowedFeeds.map((feed) => feed.url),
                revision: snapshot.revision,
              },
              evidence,
            });
            let candidate = evaluation.candidates.find(
              (item) =>
                item.packageId.toLowerCase() ===
                  requested.packageId!.toLowerCase() &&
                selected.includes(item.projectPath),
            );
            if (!candidate && requested.version) {
              const catalog = catalogs.find(
                (catalog) =>
                  catalog.packageId.toLowerCase() ===
                    requested.packageId!.toLowerCase() && catalog.complete,
              );
              const version = catalog?.versions.find(
                (version) =>
                  version.listed &&
                  sameNuGetVersion(version.version, requested.version!),
              );
              const declarations = new Set(
                snapshot.references
                  .filter(
                    (reference) =>
                      selected.includes(reference.projectPath) &&
                      reference.packageId.toLowerCase() ===
                        requested.packageId!.toLowerCase(),
                  )
                  .map((reference) => reference.declarationPath),
              );
              const related = snapshot.references.filter(
                (reference) =>
                  reference.direct &&
                  reference.declarationPath &&
                  declarations.has(reference.declarationPath) &&
                  reference.packageId.toLowerCase() ===
                    requested.packageId!.toLowerCase(),
              );
              const feeds =
                version?.feedUrls.filter((url) =>
                  allowedFeeds.some(
                    (feed) => sourceIdentity(feed.url) === sourceIdentity(url),
                  ),
                ) ?? [];
              if (
                related.length &&
                feeds.length &&
                related.every(
                  (reference) =>
                    reference.resolvedVersion &&
                    reference.requestedVersion &&
                    sameNuGetVersion(
                      reference.requestedVersion,
                      requested.version!,
                    ) &&
                    compareNuGetVersions(
                      reference.resolvedVersion,
                      requested.version!,
                    ) <= 0,
                ) &&
                related.some(
                  (reference) =>
                    !sameNuGetVersion(
                      reference.resolvedVersion!,
                      requested.version!,
                    ),
                )
              ) {
                const recovery: UpgradeCandidate = {
                  key: "",
                  projectPath: selected[0]!,
                  packageId: requested.packageId!,
                  version: requested.version,
                  feedUrls: feeds,
                  referenceIds: related.map(
                    (reference) => reference.referenceId,
                  ),
                  compatibility: {
                    status: "unverified",
                    reason: "pending-restore",
                    diagnostics: [],
                  },
                };
                recovery.key = candidateKey(recovery);
                if (!evidence.has(recovery.key)) candidate = recovery;
              }
            }
            if (!candidate) break;
            const verification = await adapter.verify(
              candidate,
              snapshot,
              { ...context, projectPaths: snapshot.projectPaths },
              signal,
            );
            if (verification.kind !== "verified")
              throw new Error(
                "The requested update could not be verified in the current context.",
              );
            const { request, evidence: proof } = verification;
            if (
              proof.contextRevision !== request.project.contextRevision ||
              proof.planRevision !== request.planRevision ||
              proof.candidateKey !== candidateKey(candidate)
            )
              throw new Error(
                "The compatibility proof does not match the prepared plan.",
              );
            if (proof.result.status === "incompatible") {
              evidence.set(candidate.key, {
                contextRevision: snapshot.revision,
                result: proof.result,
              });
              continue;
            }
            if (proof.result.status !== "compatible")
              throw new Error(
                "The update is currently unverified; no project files were changed.",
              );
            const affected = request.plan.files.length
              ? [
                  ...new Set(
                    request.project.references
                      .filter((reference) =>
                        candidate!.referenceIds.includes(reference.referenceId),
                      )
                      .flatMap((reference) => reference.affectedProjectPaths),
                  ),
                ].sort()
              : selected;
            const key = hash([
              request.planRevision,
              candidate.packageId.toLowerCase(),
            ]);
            if (!seen.has(key)) {
              seen.add(key);
              bindings.push({
                step: {
                  ...requested,
                  version: candidate.version,
                  projectPaths: affected,
                  feedUrls: candidate.feedUrls,
                },
                project: request.project,
                edit: request.plan,
              });
            }
            bound = true;
            break;
          }
          if (!bound) {
            const references = snapshot.references.filter(
              (reference) =>
                selected.includes(reference.projectPath) &&
                reference.packageId.toLowerCase() ===
                  requested.packageId!.toLowerCase() &&
                reference.direct,
            );
            if (
              references.length &&
              references.every(
                (reference) =>
                  reference.resolvedVersion &&
                  sameNuGetVersion(
                    reference.resolvedVersion,
                    requested.version!,
                  ),
              )
            )
              continue;
            throw new Error(
              "No verified upgrade remains for the requested package. Refresh or restore the affected projects before retrying.",
            );
          }
          continue;
        }
        for (const projectPath of selected) {
          const project = adapter.evaluation(snapshot.revision, projectPath);
          if (!project?.isolation.supported)
            throw new Error(
              "The declaration scope is unverified. This operation cannot safely change its project inputs.",
            );
          const references = snapshot.references.filter(
            (reference) =>
              reference.projectPath === projectPath &&
              reference.direct &&
              reference.packageId.toLowerCase() ===
                requested.packageId!.toLowerCase(),
          );
          const node = project.projects.find(
            (node) => pathKey(node.path) === pathKey(projectPath),
          )!;
          if (requested.action === "remove" || !references.length) {
            const directItems = node.frames
              .flatMap((frame) => frame.items.PackageReference ?? [])
              .filter(
                (item) =>
                  item.Identity?.toLowerCase() ===
                  requested.packageId!.toLowerCase(),
              );
            if (
              directItems.some(
                (item) =>
                  pathKey(item.DefiningProjectFullPath ?? "") !==
                  pathKey(projectPath),
              )
            )
              throw new Error(
                "Imported declarations require a scoped declaration edit, not a CLI override.",
              );
            if (requested.action === "remove" && !references.length) continue;
            if (requested.action !== "remove") {
              const central = node.frames
                .flatMap((frame) => frame.items.PackageVersion ?? [])
                .filter(
                  (item) =>
                    item.Identity?.toLowerCase() ===
                    requested.packageId!.toLowerCase(),
                );
              if (
                central.some(
                  (item) =>
                    !item.Version ||
                    !sameNuGetVersion(item.Version, requested.version!),
                )
              )
                throw new Error(
                  "Adding this reference would change a shared central version outside the add intent.",
                );
              if (
                !central.length &&
                node.frames.some(
                  (frame) =>
                    frame.properties.ManagePackageVersionsCentrally?.toLowerCase() ===
                    "true",
                ) &&
                project.references.some(
                  (reference) =>
                    reference.packageId.toLowerCase() ===
                      requested.packageId!.toLowerCase() &&
                    !snapshot.projectPaths.includes(reference.projectPath),
                )
              )
                throw new Error(
                  "A new central version would affect a project outside this selection.",
                );
            }
            bindings.push({
              step: {
                ...requested,
                action: requested.action === "remove" ? "remove" : "add",
                projectPaths: [projectPath],
              },
              project,
            });
          } else {
            if (
              references.every(
                (reference) =>
                  reference.resolvedVersion &&
                  sameNuGetVersion(
                    reference.resolvedVersion,
                    requested.version!,
                  ),
              )
            )
              continue;
            const changes: VersionDeclarationChange[] = references.map(
              (reference) => {
                if (
                  !reference.declarationPath ||
                  !reference.requestedVersion ||
                  reference.affectedProjectPaths.some(
                    (file) => !snapshot.projectPaths.includes(file),
                  )
                )
                  throw new Error(
                    "The declaration affects projects outside the approved selection.",
                  );
                const frame = node.frames.find(
                  (frame) => frame.framework === reference.framework,
                )!;
                return {
                  declarationPath: reference.declarationPath,
                  kind:
                    frame.properties.ManagePackageVersionsCentrally?.toLowerCase() ===
                    "true"
                      ? "PackageVersion"
                      : "PackageReference",
                  packageId: reference.packageId,
                  expectedVersion: reference.requestedVersion,
                  version: requested.version!,
                  affectedProjectPaths: reference.affectedProjectPaths,
                };
              },
            );
            const documents = [];
            for (const file of new Set(
              changes.map((change) => change.declarationPath),
            )) {
              const input = project.inputs.find(
                (input) => input.path === file,
              )!;
              const bytes = await readScopedFile(file, input.scopeRoot);
              if (!bytes || contentHash(bytes) !== input.hash)
                throw new Error("A declaration changed during preparation.");
              documents.push({
                path: file,
                text: decodeProjectText(bytes).text,
              });
            }
            const edit = createVersionEditPlan({
              documents,
              changes,
              selectedProjectPaths: snapshot.projectPaths,
              contextRevision: project.contextRevision,
            });
            const affected = edit.files.length
              ? [
                  ...new Set(
                    changes.flatMap((change) => change.affectedProjectPaths),
                  ),
                ].sort()
              : [projectPath];
            const key = hash([edit, requested.packageId]);
            if (!seen.has(key)) {
              seen.add(key);
              bindings.push({
                project,
                edit,
                step: {
                  ...requested,
                  projectPaths: affected,
                  action: references.some(
                    (reference) =>
                      reference.resolvedVersion &&
                      compareNuGetVersions(
                        requested.version!,
                        reference.resolvedVersion,
                      ) < 0,
                  )
                    ? "downgrade"
                    : "update",
                },
              });
            }
          }
        }
      }
      const prepared = freezeMutationPlan({
        ...plan,
        contextRevision: snapshot.revision,
        steps: bindings.map((binding, index) => ({
          ...binding.step,
          id: `${index}:${binding.step.packageId}:${binding.step.projectPaths.join("|")}`,
        })),
      });
      const byId = new Map(
        prepared.steps.map((step, index) => [
          step.id,
          { ...bindings[index]!, step },
        ]),
      );
      return {
        plan: prepared,
        execute: (step, cancelled) =>
          this.execute(byId.get(step.id)!, environment, cancelled),
      };
    } finally {
      adapter.dispose();
    }
  }
  async reconcile(plan: MutationPlan): Promise<void> {
    if (plan.targetId !== this.intent.context.targetId)
      throw new Error("Reconciliation cannot change the operation target.");
    await this.reconcileFacts({
      ...this.live(),
      target: this.intent.environment.target,
    });
  }
  private assertClean(paths: readonly string[]): void {
    const allowed = new Set(paths.map(pathKey));
    if (
      (workspace.textDocuments ?? []).some(
        (document) =>
          document.isDirty && allowed.has(pathKey(document.uri.fsPath)),
      )
    )
      throw new Error(
        "Save affected project inputs before running this operation.",
      );
  }
  private async execute(
    binding: Binding,
    environment: DataEnvironment,
    cancelled: () => boolean = () => false,
  ): Promise<readonly string[]> {
    const { step, project, edit } = binding;
    if (!project?.restoreConfigPath)
      throw new Error("No verified restore configuration is available.");
    await verifyProjectInputs(project.inputs, project.directories);
    this.assertClean(project.inputPaths);
    for (const file of step.projectPaths) {
      if (
        (await resolveDotnetSdk(environment.cli, file)).version !==
        project.projects.find((node) => pathKey(node.path) === pathKey(file))
          ?.sdk.version
      )
        throw new Error("The effective SDK changed before editing.");
    }
    const changed = new Set<string>();
    const projects = step.projectPaths.map((projectPath) => ({
      projectPath,
      status: "not-executed" as "completed" | "failed" | "not-executed",
    }));
    let activeProject: (typeof projects)[number] | undefined;
    const scratch = await fs.mkdtemp(
      path.join(os.tmpdir(), "nuget-operation-"),
    );
    try {
      const configBytes = await readScopedFile(
        project.restoreConfigPath,
        project.inputs.find(
          (input) => input.path === project.restoreConfigPath,
        )!.scopeRoot,
      );
      if (!configBytes) throw new Error("Restore configuration disappeared.");
      const cacheRoots = step.projectPaths.map(
        (file) =>
          project.projects.find((node) => pathKey(node.path) === pathKey(file))
            ?.frames[0]?.properties.NuGetPackageRoot,
      );
      const cacheRoot = cacheRoots[0];
      if (
        !cacheRoot ||
        !path.isAbsolute(cacheRoot) ||
        cacheRoots.some(
          (value) => !value || pathKey(value) !== pathKey(cacheRoot),
        )
      )
        throw new Error(
          "The package cache location could not be proven for this operation.",
        );
      const configPath = path.join(scratch, "NuGet.Config");
      let config = isolatedConfig(
        decodeProjectText(configBytes).text,
        project.restoreConfigPath,
        cacheRoot,
      );
      if (step.action !== "remove")
        config = restrictCompatibilitySources(
          config,
          step.packageId!,
          project.feedUrls,
          step.feedUrls,
        );
      await fs.writeFile(configPath, config, { mode: 0o600 });
      if (step.action !== "remove")
        await this.checkOrigin(cacheRoot, step, true);
      if (cancelled())
        throw new DOMException("Operation cancelled.", "AbortError");
      if (edit) {
        const io = createVersionEditIO(
          new Map(
            edit.files.map((file) => [
              file.path,
              project.inputs.find((input) => input.path === file.path)!
                .scopeRoot,
            ]),
          ),
          this.editor,
          cancelled,
        );
        try {
          await applyVersionEditPlan(edit, {
            io,
            contextRevision: project.contextRevision,
          });
        } finally {
          for (const file of io.changedPaths) changed.add(file);
        }
      }
      for (const file of step.projectPaths) {
        if (cancelled())
          throw new DOMException("Operation cancelled.", "AbortError");
        activeProject = projects.find((entry) => entry.projectPath === file)!;
        const sdk = await resolveDotnetSdk(environment.cli, file);
        const expected = project.projects.find(
          (node) => pathKey(node.path) === pathKey(file),
        );
        if (!expected || sdk.version !== expected.sdk.version)
          throw new Error("The effective SDK changed before execution.");
        if (!edit) {
          const args = dotnetArguments(
            sdk,
            step.action === "remove"
              ? {
                  kind: "remove",
                  projectPath: file,
                  packageId: step.packageId!,
                }
              : {
                  kind: "add",
                  projectPath: file,
                  packageId: step.packageId!,
                  version: step.version!,
                },
          );
          if (step.action !== "remove") args.push("--no-restore");
          const command = await environment.cli.runDotnet(
            args,
            path.dirname(file),
            { privateDiagnostics: true },
          );
          changed.add(file);
          if (command.code !== 0)
            throw new Error(
              `Package edit failed in ${path.basename(file)} (exit ${command.code}).`,
            );
        }
        const restored = await environment.cli.runDotnet(
          [
            "restore",
            file,
            "--configfile",
            configPath,
            "--packages",
            cacheRoot,
          ],
          path.dirname(file),
          { privateDiagnostics: true },
        );
        if (restored.code !== 0)
          throw new Error(
            `Restore failed in ${path.basename(file)} (exit ${restored.code}).`,
          );
        const actual = await NuGetClient.loadInstalledReferences({
          target: {
            id: file,
            kind: "project",
            name: path.basename(file),
            path: file,
            projectPaths: [file],
          },
          cli: environment.cli,
          logger: this.logger,
          readOnly: true,
        });
        const references = actual.filter(
          (reference) =>
            reference.direct &&
            reference.packageId.toLowerCase() === step.packageId!.toLowerCase(),
        );
        if (
          step.action === "remove"
            ? references.length > 0
            : !references.length ||
              references.some(
                (reference) =>
                  !reference.resolvedVersion ||
                  !sameNuGetVersion(reference.resolvedVersion, step.version!),
              )
        )
          throw new Error(
            "The actual package inventory does not match the requested operation.",
          );
        if (step.action !== "remove")
          await this.checkOrigin(cacheRoot, step, false);
        activeProject.status = "completed";
        activeProject = undefined;
      }
      return [...changed];
    } catch (cause) {
      if (activeProject) activeProject.status = "failed";
      const abort =
        cancelled() &&
        cause instanceof Error &&
        (cause.name === "AbortError" ||
          (cause.cause instanceof Error && cause.cause.name === "AbortError"));
      throw Object.assign(
        new Error(
          cause instanceof Error ? cause.message : "Package operation failed.",
          { cause },
        ),
        {
          name: abort ? "AbortError" : "Error",
          changedPaths: [...changed],
          projects,
        },
      );
    } finally {
      await fs.rm(scratch, { recursive: true, force: true });
    }
  }
  private async checkOrigin(
    cacheRoot: string,
    step: MutationStep,
    allowMissing: boolean,
  ): Promise<void> {
    const version = parseNuGetVersion(step.version!)!.normalized.toLowerCase();
    let metadata: { source?: string };
    try {
      const root = await fs.realpath(cacheRoot);
      const bytes = await readScopedFile(
        path.join(
          root,
          step.packageId!.toLowerCase(),
          version,
          ".nupkg.metadata",
        ),
        root,
      );
      if (!bytes && allowMissing) return;
      if (!bytes) throw new Error("Package metadata is missing.");
      metadata = JSON.parse(bytes.toString("utf8")) as typeof metadata;
    } catch (error) {
      if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT")
        return;
      throw new Error("The cached package origin could not be verified.", {
        cause: error,
      });
    }
    const identities = new Set(step.feedUrls.map(sourceIdentity));
    for (const source of step.feedUrls)
      if (!/^https?:/i.test(source))
        identities.add(
          sourceIdentity(await fs.realpath(sourceIdentity(source))),
        );
    if (!metadata.source || !identities.has(sourceIdentity(metadata.source)))
      throw new Error(
        "The cached package belongs to a different source. Clear that cache before retrying.",
      );
  }
}
