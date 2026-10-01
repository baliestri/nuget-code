import fs from "node:fs/promises";
import path from "node:path";
import type {
  CompatibilityResult,
  PackageVersionEditPlan,
  PlannedCompatibilityEvidence,
  UpgradeCandidate,
  VersionDeclarationChange,
} from "#contracts";
import {
  candidateKey,
  compareNuGetVersions,
  parseNuGetVersion,
  sameNuGetVersion,
} from "#manager";
import type { NuGetCli } from "#client/cli";
import {
  type EvaluatedProject,
  ProjectContextError,
} from "#client/project-context";
import {
  contentHash,
  decodeProjectText,
  pathKey,
  readScopedFile,
  verifyProjectInputs,
} from "#client/project-files";
import {
  createVersionEditPlan,
  applyVersionEditPlan,
  VersionEditError,
} from "#client/package-version-edits";
import {
  createCompatibilitySandbox,
  validateCompatibilitySandbox,
  sandboxVersionEditIO,
  type CompatibilitySandbox,
} from "#client/compatibility-sandbox";
import {
  restrictCompatibilitySources,
  sourceIdentity,
} from "#client/compatibility-sources";

export interface CompatibilityIntent {
  readonly project: EvaluatedProject;
  readonly candidate: UpgradeCandidate;
  readonly selectedProjectPaths: readonly string[];
  /** Complete authorized dependency sources, not just the selected target source. */
  readonly feedUrls: readonly string[];
}
export interface CompatibilityRequest extends CompatibilityIntent {
  readonly plan: PackageVersionEditPlan;
  readonly planRevision: string;
}
export function compatibilityRequestKey(request: CompatibilityRequest): string {
  return JSON.stringify([
    candidateKey(request.candidate),
    request.project.contextRevision,
    request.planRevision,
  ]);
}
const unverified = (
  reason: string,
  diagnostics: readonly string[] = [],
): CompatibilityResult => ({ status: "unverified", reason, diagnostics });
const sameSet = (a: readonly string[], b: readonly string[]) =>
  JSON.stringify([...new Set(a)].sort()) ===
  JSON.stringify([...new Set(b)].sort());

export function classifyRestore(options: {
  exitCode: number | null;
  diagnostics: readonly { code: string; message: string }[];
  resolvedVersions: readonly string[];
  requestedVersion: string;
  expectedFrameworks: readonly string[];
  restoredFrameworks: readonly string[];
}): CompatibilityResult {
  // Only stable diagnostic codes leave the process boundary; messages may contain credentials.
  const diagnostics = [
    ...new Set(
      options.diagnostics.map((item) =>
        /^[A-Z]+\d{4}$/.test(item.code) ? item.code : "unknown-diagnostic",
      ),
    ),
  ].sort();
  const incompatible = new Set([
    "NU1201",
    "NU1202",
    "NU1107",
    "NU1605",
    "NU1608",
    "NU1701",
  ]);
  if (options.exitCode === null)
    return unverified("restore-interrupted", diagnostics);
  if (diagnostics.some((code) => !incompatible.has(code)))
    return unverified("restore-incomplete", diagnostics);
  if (
    !parseNuGetVersion(options.requestedVersion) ||
    options.resolvedVersions.some(
      (value) =>
        !parseNuGetVersion(value) ||
        !sameNuGetVersion(value, options.requestedVersion),
    )
  )
    return unverified("resolved-version-mismatch", diagnostics);
  if (diagnostics.length) return { status: "incompatible", diagnostics };
  if (options.exitCode !== 0) return unverified("restore-failed", diagnostics);
  if (
    !options.expectedFrameworks.length ||
    !sameSet(options.expectedFrameworks, options.restoredFrameworks)
  )
    return unverified("frameworks-incomplete", diagnostics);
  if (!options.resolvedVersions.length)
    return unverified("resolved-version-mismatch", diagnostics);
  return { status: "compatible", diagnostics };
}

/** Host-only preparation. Selection is independent from the evaluated consumer scope. */
export async function prepareCompatibilityRequest(
  intent: CompatibilityIntent,
  signal?: AbortSignal,
): Promise<CompatibilityRequest> {
  signal?.throwIfAborted();
  const { project, candidate } = intent;
  if (!project.isolation.supported)
    throw new ProjectContextError(
      "unsupported-context",
      "The project context is incomplete.",
    );
  if (
    project.projects.some((node) =>
      node.frames.some(
        (frame) =>
          frame.properties.CentralPackageTransitivePinningEnabled?.toLowerCase() ===
          "true",
      ),
    )
  )
    throw new ProjectContextError(
      "unsupported-context",
      "Transitive central consumers require a complete declaration scope proof.",
    );
  if (
    candidate.key !== candidateKey(candidate) ||
    !sameSet(
      intent.feedUrls.map(sourceIdentity),
      project.feedUrls.map(sourceIdentity),
    )
  )
    throw new VersionEditError(
      "stale-context",
      "The candidate or sources changed.",
    );
  if (
    !candidate.feedUrls.length ||
    candidate.feedUrls.some(
      (source) =>
        !intent.feedUrls.map(sourceIdentity).includes(sourceIdentity(source)),
    )
  )
    throw new VersionEditError(
      "scope-mismatch",
      "The target sources are not authorized.",
    );
  await verifyProjectInputs(project.inputs, project.directories, signal);
  const selected = project.references.filter((reference) =>
    candidate.referenceIds.includes(reference.referenceId),
  );
  if (
    !selected.length ||
    !sameSet(
      selected.map((reference) => reference.referenceId),
      candidate.referenceIds,
    ) ||
    !selected.some(
      (reference) =>
        pathKey(reference.projectPath) === pathKey(candidate.projectPath),
    )
  )
    throw new VersionEditError(
      "scope-mismatch",
      "The candidate references are incomplete.",
    );
  const declarations = new Set(
    selected.map((reference) => reference.declarationPath),
  );
  const related = project.references.filter(
    (reference) =>
      reference.direct &&
      reference.packageId.toLowerCase() === candidate.packageId.toLowerCase() &&
      (pathKey(reference.projectPath) === pathKey(candidate.projectPath) ||
        declarations.has(reference.declarationPath)),
  );
  if (
    !sameSet(
      selected.map((reference) => reference.referenceId),
      related.map((reference) => reference.referenceId),
    )
  )
    throw new VersionEditError(
      "scope-mismatch",
      "Every affected reference must be present.",
    );
  const changes: VersionDeclarationChange[] = [];
  for (const reference of selected) {
    if (
      !reference.direct ||
      reference.packageId.toLowerCase() !== candidate.packageId.toLowerCase() ||
      !reference.declarationPath ||
      !reference.requestedVersion ||
      !reference.affectedProjectPaths.length
    )
      throw new VersionEditError(
        "scope-mismatch",
        "The declaration scope is unknown.",
      );
    const consumers = related
      .filter((other) => other.declarationPath === reference.declarationPath)
      .map((other) => other.projectPath);
    if (
      !sameSet(
        consumers.map(pathKey),
        reference.affectedProjectPaths.map(pathKey),
      )
    )
      throw new VersionEditError(
        "scope-mismatch",
        "The evaluated consumers are incomplete.",
      );
    if (
      compareNuGetVersions(
        candidate.version,
        reference.resolvedVersion ?? reference.requestedVersion,
      ) < 0
    )
      throw new VersionEditError(
        "stale-context",
        "The candidate is not an upgrade.",
      );
    const frame = project.projects
      .find((node) => pathKey(node.path) === pathKey(reference.projectPath))
      ?.frames.find((item) => item.framework === reference.framework);
    if (!frame)
      throw new VersionEditError(
        "scope-mismatch",
        "The framework was not evaluated.",
      );
    changes.push({
      declarationPath: reference.declarationPath,
      kind:
        frame.properties.ManagePackageVersionsCentrally?.toLowerCase() ===
        "true"
          ? "PackageVersion"
          : "PackageReference",
      packageId: candidate.packageId,
      expectedVersion: reference.requestedVersion,
      version: candidate.version,
      affectedProjectPaths: reference.affectedProjectPaths,
    });
  }
  const documents = [];
  if (
    !selected.some(
      (reference) =>
        compareNuGetVersions(
          candidate.version,
          reference.resolvedVersion ?? reference.requestedVersion!,
        ) > 0,
    )
  )
    throw new VersionEditError(
      "stale-context",
      "The requested version is already resolved for every affected reference.",
    );
  for (const file of new Set(changes.map((change) => change.declarationPath))) {
    const input = project.inputs.find(
      (item) => pathKey(item.path) === pathKey(file),
    );
    if (!input)
      throw new VersionEditError(
        "missing-document",
        "The declaration was not captured.",
      );
    const bytes = await readScopedFile(input.path, input.scopeRoot);
    if (!bytes || contentHash(bytes) !== input.hash)
      throw new VersionEditError("stale-document", "The declaration changed.");
    documents.push({ path: input.path, text: decodeProjectText(bytes).text });
  }
  const plan = createVersionEditPlan({
    documents,
    changes,
    selectedProjectPaths: intent.selectedProjectPaths,
    contextRevision: project.contextRevision,
  });
  return Object.freeze({
    project,
    candidate: Object.freeze({
      ...candidate,
      referenceIds: Object.freeze([...candidate.referenceIds]),
      feedUrls: Object.freeze([...candidate.feedUrls]),
    }),
    feedUrls: Object.freeze([...intent.feedUrls]),
    selectedProjectPaths: Object.freeze([...intent.selectedProjectPaths]),
    plan,
    planRevision: contentHash(JSON.stringify(plan)),
  });
}

type Assets = {
  targets: Record<string, Record<string, { type?: string }>>;
  libraries: Record<string, { type?: string; path?: string; files?: string[] }>;
  logs?: { code: string; message: string }[];
};

async function restoreCandidate(
  cli: Pick<NuGetCli, "runDotnet">,
  request: CompatibilityRequest,
  sandbox: CompatibilitySandbox,
  signal: AbortSignal,
): Promise<CompatibilityResult> {
  const { project, candidate, plan } = request;
  const targetSources = new Set(candidate.feedUrls.map(sourceIdentity));
  for (const source of candidate.feedUrls) {
    if (!/^https?:\/\//i.test(source))
      targetSources.add(
        sourceIdentity(await fs.realpath(sourceIdentity(source))),
      );
  }
  const config = restrictCompatibilitySources(
    await fs.readFile(sandbox.restoreConfigPath, "utf8"),
    candidate.packageId,
    request.feedUrls,
    candidate.feedUrls,
  );
  await fs.writeFile(sandbox.restoreConfigPath, config, { mode: 0o600 });
  await applyVersionEditPlan(plan, {
    contextRevision: project.contextRevision,
    fileMap: sandbox.sourceToCopy,
    io: sandboxVersionEditIO(sandbox),
  });
  const affected = new Set(
    project.references
      .filter((reference) =>
        candidate.referenceIds.includes(reference.referenceId),
      )
      .flatMap((reference) => reference.affectedProjectPaths)
      .map(pathKey),
  );
  const results: CompatibilityResult[] = [];
  for (const node of project.projects.filter((item) =>
    affected.has(pathKey(item.path)),
  )) {
    signal.throwIfAborted();
    // Source overrides/fallbacks cannot bypass the temporary mapping unnoticed.
    if (
      node.frames.some((frame) =>
        ["RestoreSources", "RestoreFallbackFolders"].some(
          (key) => !!frame.properties[key],
        ),
      )
    )
      return unverified("source-overrides-unverified");
    const copied = sandbox.sourceToCopy.get(node.path);
    if (!copied) return unverified("missing-project-mapping");
    const assetsPath = path.join(
      path.dirname(copied),
      "obj",
      "project.assets.json",
    );
    // Never classify a failed attempt using assets from the equivalence restore.
    await fs.rm(assetsPath, { force: true });
    const restored = await cli.runDotnet(
      [
        "restore",
        copied,
        "--configfile",
        sandbox.restoreConfigPath,
        "--packages",
        sandbox.packagesPath,
      ],
      path.dirname(copied),
      { signal },
    );
    signal.throwIfAborted();
    const codes = [
      ...new Set(
        `${restored.stdout}\n${restored.stderr}`.match(
          /\b(?:NU|NETSDK|MSB)\d{4}\b/g,
        ) ?? [],
      ),
    ];
    let assets: Assets | undefined;
    try {
      assets = JSON.parse(
        (await readScopedFile(assetsPath, sandbox.root))!.toString("utf8"),
      ) as Assets;
    } catch {
      /* Missing/invalid assets never establish success. */
    }
    const diagnostics = [
      ...codes.map((code) => ({ code, message: "" })),
      ...(Array.isArray(assets?.logs) ? assets.logs : []),
    ];
    const frameworks: string[] = [];
    const versions: string[] = [];
    let complete = !!assets?.targets && !!assets?.libraries;
    if (complete && assets) {
      if (
        Object.values(assets.libraries).some(
          (library) =>
            library.type === "package" && !Array.isArray(library.files),
        )
      )
        return unverified("package-manifest-incomplete");
      // Do not execute another MSBuild invocation after discovering unproven package imports.
      if (
        Object.values(assets.libraries).some((library) =>
          library.files?.some((file) =>
            /^build(?:Transitive|MultiTargeting)?\//i.test(file),
          ),
        )
      )
        return unverified("package-build-import");
      for (const frame of node.frames) {
        const targets = Object.entries(assets.targets).filter(([name]) =>
          [frame.framework, frame.properties.TargetFrameworkMoniker].includes(
            name.split("/")[0]!,
          ),
        );
        if (targets.length) frameworks.push(frame.framework);
        const runtimes = (
          frame.properties.RuntimeIdentifiers ||
          frame.properties.RuntimeIdentifier ||
          ""
        )
          .split(";")
          .filter(Boolean);
        if (
          runtimes.some(
            (runtime) =>
              !targets.some(([name]) => name.endsWith(`/${runtime}`)),
          )
        )
          complete = false;
        const expected = project.references.some(
          (reference) =>
            candidate.referenceIds.includes(reference.referenceId) &&
            pathKey(reference.projectPath) === pathKey(node.path) &&
            reference.framework === frame.framework,
        );
        if (!expected) continue;
        for (const [, packages] of targets) {
          const identities = Object.entries(packages).filter(
            ([identity, value]) =>
              value.type === "package" &&
              identity.slice(0, identity.lastIndexOf("/")).toLowerCase() ===
                candidate.packageId.toLowerCase(),
          );
          if (identities.length !== 1) {
            complete = false;
            continue;
          }
          const identity = identities[0]![0];
          versions.push(identity.slice(identity.lastIndexOf("/") + 1));
          const library = assets.libraries[identity];
          if (!library?.path) {
            complete = false;
            continue;
          }
          try {
            const bytes = await readScopedFile(
              path.join(sandbox.packagesPath, library.path, ".nupkg.metadata"),
              sandbox.packagesPath,
            );
            const metadata = JSON.parse(bytes!.toString("utf8")) as {
              source?: string;
            };
            if (
              !metadata.source ||
              !targetSources.has(sourceIdentity(metadata.source))
            )
              complete = false;
          } catch {
            complete = false;
          }
        }
      }
    }
    const result = classifyRestore({
      exitCode: restored.code,
      diagnostics,
      requestedVersion: candidate.version,
      resolvedVersions: versions,
      expectedFrameworks: node.frames.map((frame) => frame.framework),
      restoredFrameworks: frameworks,
    });
    results.push(
      result.status !== "unverified" && !complete
        ? unverified("assets-or-source-unverified")
        : result,
    );
    // Failure may leave new imports; do not start another restore in that tree.
    if (result.status !== "compatible" || !complete) break;
  }
  return (
    results.find((result) => result.status === "unverified") ??
    results.find((result) => result.status === "incompatible") ??
    (results.length
      ? { status: "compatible", diagnostics: [] }
      : unverified("empty-scope"))
  );
}

export async function verifyPackageCompatibility(
  cli: NuGetCli,
  request: CompatibilityRequest,
  consumerSignal?: AbortSignal,
): Promise<PlannedCompatibilityEvidence> {
  const deadline = AbortSignal.timeout(180_000);
  const signal = consumerSignal
    ? AbortSignal.any([consumerSignal, deadline])
    : deadline;
  let sandbox: CompatibilitySandbox | undefined;
  let result: CompatibilityResult;
  const privateCli: Pick<NuGetCli, "runDotnet"> = {
    runDotnet: (args, cwd, options) =>
      cli.runDotnet(args, cwd, { ...options, privateDiagnostics: true }),
  };
  try {
    signal.throwIfAborted();
    const current = await prepareCompatibilityRequest(request, signal);
    if (
      current.planRevision !== request.planRevision ||
      JSON.stringify(current.plan) !== JSON.stringify(request.plan)
    )
      throw new VersionEditError("stale-context", "The prepared plan changed.");
    sandbox = await createCompatibilitySandbox(request.project, signal);
    await validateCompatibilitySandbox(
      privateCli,
      request.project,
      sandbox,
      signal,
    );
    result = await restoreCandidate(privateCli, request, sandbox, signal);
    signal.throwIfAborted();
    await verifyProjectInputs(
      request.project.inputs,
      request.project.directories,
      signal,
    );
  } catch (error) {
    const reason = consumerSignal?.aborted
      ? "cancelled"
      : deadline.aborted
        ? "timeout"
        : error instanceof VersionEditError ||
            error instanceof ProjectContextError
          ? error.code
          : "verification-failed";
    result = unverified(reason);
  } finally {
    if (sandbox) {
      try {
        await sandbox.dispose();
      } catch {
        result = unverified("cleanup-failed");
      }
    }
  }
  if (consumerSignal?.aborted) result = unverified("cancelled");
  else if (deadline.aborted) result = unverified("timeout");
  return {
    contextRevision: request.project.contextRevision,
    candidateKey: request.candidate.key,
    planRevision: request.planRevision,
    result: result!,
  };
}
