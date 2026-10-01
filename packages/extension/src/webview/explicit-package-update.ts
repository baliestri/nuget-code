import fs from "node:fs/promises";
import path from "node:path";
import type {
  MutationPlan,
  MutationStep,
  VersionDeclarationChange,
} from "#contracts";
import {
  applyVersionEditPlan,
  createVersionEditPlan,
  NuGetClient,
  resolveDotnetSdk,
} from "#client";
import { collectProjectInputs } from "#client/project-inputs";
import { runProjectQuery } from "#client/project-msbuild";
import {
  containsPath,
  contentHash,
  decodeProjectText,
  pathKey,
  readScopedFile,
  verifyProjectInputs,
} from "#client/project-files";
import {
  freezeMutationPlan,
  parseNuGetVersion,
  sameNuGetVersion,
} from "#manager";
import type { DataEnvironment } from "./package-data-adapter";
import type { PreparedMutation } from "./mutation-service";
import { createVersionEditIO, type EditorPort } from "./version-edit-io";
import type { NuGetClientLogger } from "#client/types";

/** Explicit version edits use the real project context. Isolation is only an automatic-update prerequisite. */
export async function prepareExplicitUpdate(
  plan: MutationPlan,
  environment: DataEnvironment,
  selectedProjects: readonly string[],
  signal: AbortSignal,
  assertClean: (paths: readonly string[]) => void,
  logger: NuGetClientLogger,
  editor?: EditorPort,
): Promise<PreparedMutation | undefined> {
  const roots = await Promise.all(
    environment.allowedRoots.map((root) => fs.realpath(root)),
  );
  const selected = new Set(selectedProjects.map(pathKey));
  const scopes = new Map<
    string,
    Awaited<ReturnType<typeof collectProjectInputs>>
  >();
  for (const file of selectedProjects) {
    const root = roots
      .filter((root) => containsPath(root, file))
      .sort((a, b) => a.length - b.length)[0];
    if (!root)
      throw new Error("The selected project is outside the workspace.");
    if (!scopes.has(pathKey(root)))
      scopes.set(
        pathKey(root),
        await collectProjectInputs(
          {
            projectPath: file,
            allowedRoots: [root],
            feedUrls: [],
            sourceRevision: environment.sourceRevision,
          },
          signal,
        ),
      );
  }
  const inputs = [
    ...new Map(
      [...scopes.values()]
        .flatMap((scope) => scope.inputs)
        .filter((input) => !["assets", "generated"].includes(input.kind))
        .map((input) => [pathKey(input.path), { ...input }]),
    ).values(),
  ];
  for (const requestedConfig of environment.configPaths) {
    const scopeRoot = await fs.realpath(path.dirname(requestedConfig));
    const file = path.join(scopeRoot, path.basename(requestedConfig));
    const bytes = await readScopedFile(file, scopeRoot);
    if (!inputs.some((input) => pathKey(input.path) === pathKey(file)))
      inputs.push({
        path: file,
        scopeRoot,
        hash: bytes ? contentHash(bytes) : null,
        kind: "configuration",
        copy: false,
      });
  }
  const directories = [...scopes.values()].flatMap(
    (scope) => scope.directories,
  );
  const files = [
    ...new Set([...scopes.values()].flatMap((scope) => scope.projectPaths)),
  ].sort();
  const packages = new Set(
    plan.steps.map((step) => step.packageId?.toLowerCase()),
  );
  const declarations: (VersionDeclarationChange & { projectPath: string })[] =
    [];
  const sdks = new Map<string, string>();
  const queries: {
    file: string;
    framework: string | undefined;
    signature: string;
  }[] = [];
  const signature = (query: Awaited<ReturnType<typeof runProjectQuery>>) =>
    JSON.stringify([
      query.properties,
      Object.fromEntries(
        ["PackageReference", "PackageVersion", "ProjectReference"].map(
          (name) => [
            name,
            (query.items[name] ?? []).map((item) => [
              item.Identity,
              item.Version,
              item.VersionOverride,
              item.DefiningProjectFullPath,
              item.IsImplicitlyDefined,
            ]),
          ],
        ),
      ),
    ]);
  async function query(file: string, framework?: string) {
    const result = await runProjectQuery(
      environment.cli,
      file,
      framework,
      signal,
    );
    queries.push({ file, framework, signature: signature(result) });
    return result;
  }
  for (const file of files) {
    const sdk = await resolveDotnetSdk(environment.cli, file, signal);
    sdks.set(pathKey(file), sdk.version);
    const outer = await query(file);
    const frameworks = (
      outer.properties.TargetFrameworks ||
      outer.properties.TargetFramework ||
      ""
    )
      .split(";")
      .filter(Boolean);
    if (!frameworks.length)
      throw new Error(
        `Cannot determine target frameworks for ${path.basename(file)}.`,
      );
    for (const framework of frameworks) {
      const frame =
        frameworks.length === 1 &&
        outer.properties.TargetFramework === framework
          ? outer
          : await query(file, framework);
      for (const reference of frame.items.PackageReference ?? []) {
        if (
          !packages.has(reference.Identity?.toLowerCase()) ||
          reference.IsImplicitlyDefined?.toLowerCase() === "true"
        )
          continue;
        const central =
          frame.properties.ManagePackageVersionsCentrally?.toLowerCase() ===
            "true" && !reference.VersionOverride;
        const item = central
          ? frame.items.PackageVersion?.find(
              (item) =>
                item.Identity?.toLowerCase() ===
                reference.Identity!.toLowerCase(),
            )
          : reference;
        const declarationPath = item?.DefiningProjectFullPath;
        const expectedVersion = reference.VersionOverride || item?.Version;
        if (!declarationPath || !expectedVersion || reference.VersionOverride)
          throw new Error(
            `The version declaration for ${reference.Identity} in ${path.basename(file)} must be edited manually.`,
          );
        const root = roots.find((root) => containsPath(root, declarationPath));
        if (!root)
          throw new Error(
            "A shared version declaration lies outside the workspace.",
          );
        const bytes = await readScopedFile(declarationPath, root);
        if (!bytes) throw new Error("The version declaration disappeared.");
        if (
          !inputs.some(
            (input) => pathKey(input.path) === pathKey(declarationPath),
          )
        )
          inputs.push({
            path: declarationPath,
            scopeRoot: root,
            hash: contentHash(bytes),
            kind: "import",
            copy: false,
          });
        declarations.push({
          declarationPath,
          kind: central ? "PackageVersion" : "PackageReference",
          packageId: reference.Identity!,
          expectedVersion,
          version: "",
          affectedProjectPaths: [],
          projectPath: file,
        });
      }
    }
  }
  assertClean(inputs.map((input) => input.path));
  await verifyProjectInputs(inputs, directories, signal);
  const groups = new Map<
    string,
    { step: MutationStep; changes: VersionDeclarationChange[] }
  >();
  for (const step of plan.steps) {
    if (!step.packageId || !step.version || !parseNuGetVersion(step.version))
      throw new Error("Select a concrete NuGet version.");
    if (
      !step.feedUrls.length ||
      step.feedUrls.some(
        (url) =>
          !environment.feeds.some((feed) => feed.enabled && feed.url === url),
      )
    )
      throw new Error(
        "The selected package sources changed. Select a source again.",
      );
    for (const requested of step.projectPaths) {
      const file = await fs.realpath(requested);
      const matches = declarations.filter(
        (item) =>
          pathKey(item.projectPath) === pathKey(file) &&
          item.packageId.toLowerCase() === step.packageId!.toLowerCase(),
      );
      // Older callers can express adding a missing reference as an update.
      if (!matches.length) return undefined;
      if (
        !selected.has(pathKey(file)) &&
        !matches.every((item) =>
          declarations.some(
            (other) =>
              selected.has(pathKey(other.projectPath)) &&
              pathKey(other.declarationPath) ===
                pathKey(item.declarationPath) &&
              other.packageId.toLowerCase() === item.packageId.toLowerCase(),
          ),
        )
      )
        throw new Error(
          "An update is outside the selected projects and their shared declarations.",
        );
      for (const item of matches) {
        const key = JSON.stringify([
          pathKey(item.declarationPath),
          item.kind,
          item.packageId.toLowerCase(),
        ]);
        const related = declarations.filter(
          (other) =>
            pathKey(other.declarationPath) === pathKey(item.declarationPath) &&
            other.kind === item.kind &&
            other.packageId.toLowerCase() === item.packageId.toLowerCase(),
        );
        const affected = [
          ...new Set(related.map((other) => other.projectPath)),
        ].sort();
        const existing = groups.get(key);
        if (existing && existing.step.version !== step.version)
          throw new Error(
            "Conflicting versions were requested for a shared declaration.",
          );
        groups.set(key, {
          step: { ...step, id: String(groups.size), projectPaths: affected },
          changes: related.map((other) => ({
            declarationPath: other.declarationPath,
            kind: other.kind,
            packageId: other.packageId,
            expectedVersion: other.expectedVersion,
            version: step.version!,
            affectedProjectPaths: affected,
          })),
        });
      }
    }
  }
  const bindings = [...groups.values()];
  const prepared = freezeMutationPlan({
    ...plan,
    contextRevision: contentHash(
      JSON.stringify([inputs, declarations, environment.sourceRevision]),
    ),
    steps: bindings.map((binding, index) => ({
      ...binding.step,
      id: String(index),
    })),
  });
  async function editFor(changes: VersionDeclarationChange[]) {
    const documents = [];
    for (const file of new Set(
      changes.map((change) => change.declarationPath),
    )) {
      const input = inputs.find(
        (input) => pathKey(input.path) === pathKey(file),
      )!;
      const bytes = await readScopedFile(file, input.scopeRoot);
      if (!bytes || contentHash(bytes) !== input.hash)
        throw new Error(
          "A version declaration changed. Prepare the update again.",
        );
      documents.push({ path: file, text: decodeProjectText(bytes).text });
    }
    return createVersionEditPlan({
      documents,
      changes,
      selectedProjectPaths: files,
      contextRevision: prepared.contextRevision,
    });
  }
  // Validate all declarations before publishing a plan or changing any file.
  for (const binding of bindings) await editFor(binding.changes);
  let contextRevalidated = false;
  return {
    plan: prepared,
    execute: async (step, cancelled = () => false) => {
      const binding = bindings[Number(step.id)]!;
      const changed = new Set<string>();
      const statuses = step.projectPaths.map((projectPath) => ({
        projectPath,
        status: "not-executed" as "not-executed" | "completed" | "failed",
      }));
      let active: (typeof statuses)[number] | undefined;
      try {
        if (cancelled())
          throw new DOMException("Operation cancelled.", "AbortError");
        await verifyProjectInputs(inputs, directories);
        assertClean(inputs.map((input) => input.path));
        if (!contextRevalidated) {
          for (const captured of queries) {
            if (
              signature(
                await runProjectQuery(
                  environment.cli,
                  captured.file,
                  captured.framework,
                ),
              ) !== captured.signature
            )
              throw new Error(
                "The evaluated declarations or project settings changed. Prepare the update again.",
              );
          }
          contextRevalidated = true;
          await verifyProjectInputs(inputs, directories);
        }
        for (const file of step.projectPaths) {
          if (
            (await resolveDotnetSdk(environment.cli, file)).version !==
            sdks.get(pathKey(file))
          )
            throw new Error(
              "The effective SDK changed. Prepare the update again.",
            );
        }
        const edit = await editFor(binding.changes);
        const io = createVersionEditIO(
          new Map(
            edit.files.map((file) => [
              file.path,
              inputs.find(
                (input) => pathKey(input.path) === pathKey(file.path),
              )!.scopeRoot,
            ]),
          ),
          editor,
          cancelled,
        );
        try {
          await applyVersionEditPlan(edit, {
            io,
            contextRevision: prepared.contextRevision,
          });
        } finally {
          for (const file of io.changedPaths) changed.add(file);
        }
        for (const file of changed) {
          const input = inputs.find(
            (input) => pathKey(input.path) === pathKey(file),
          )!;
          input.hash = contentHash(await fs.readFile(file));
        }
        for (const status of statuses) {
          if (cancelled())
            throw new DOMException("Operation cancelled.", "AbortError");
          active = status;
          const file = status.projectPath;
          const result = await environment.cli.runDotnet(
            [
              "restore",
              file,
              ...step.feedUrls.flatMap((url) => ["--source", url]),
            ],
            path.dirname(file),
            { privateDiagnostics: true },
          );
          if (result.code !== 0) {
            const codes = [
              ...new Set(
                `${result.stdout}\n${result.stderr}`.match(
                  /\b(?:NU|NETSDK|MSB)\d{3,5}\b/g,
                ) ?? [],
              ),
            ];
            throw new Error(
              `NuGet restore failed in ${path.basename(file)}${codes.length ? ` (${codes.join(", ")})` : ""}. The version edit is retained; review it or restore again after resolving the error.`,
            );
          }
          const references = await NuGetClient.loadInstalledReferences({
            target: {
              id: file,
              path: file,
              name: path.basename(file),
              kind: "project",
              projectPaths: [file],
            },
            cli: environment.cli,
            logger,
            readOnly: true,
          });
          const matching = references.filter(
            (item) =>
              item.direct &&
              item.packageId.toLowerCase() === step.packageId!.toLowerCase(),
          );
          if (
            !matching.length ||
            matching.some(
              (item) =>
                !item.resolvedVersion ||
                !sameNuGetVersion(item.resolvedVersion, step.version!),
            )
          )
            throw new Error(
              "The restored inventory does not match the requested version.",
            );
          status.status = "completed";
          active = undefined;
        }
        return [...changed];
      } catch (cause) {
        if (active) active.status = "failed";
        throw Object.assign(
          new Error(
            cause instanceof Error ? cause.message : "Explicit update failed.",
            { cause },
          ),
          {
            name:
              cancelled() &&
              cause instanceof Error &&
              (cause.name === "AbortError" ||
                (cause.cause instanceof Error &&
                  cause.cause.name === "AbortError"))
                ? "AbortError"
                : cause instanceof Error
                  ? cause.name
                  : "Error",
            changedPaths: [...changed],
            projects: statuses,
          },
        );
      }
    },
  };
}
