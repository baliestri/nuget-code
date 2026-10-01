// S2 feasibility prototype for generated fixtures only, not a production sandbox.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseXml, XmlElement } from "@rgrove/parse-xml";
import { openPromise } from "yauzl";
import { sameNuGetVersion } from "#manager";
import { dotnetArguments } from "#client/dotnet-sdk";
import type { DotnetPackageList } from "#client/package-types";
import type { VersionDeclarationChange } from "#contracts";
import {
  applyVersionEditPlan,
  createVersionEditPlan,
  VersionEditError,
} from "#client/package-version-edits";
import {
  checkedDotnet,
  fixtureCli,
  type DotnetFixture,
} from "./dotnet-fixture";

type Item = Record<string, string>;
interface Evaluation {
  Properties: Record<string, string>;
  Items: Record<string, Item[]>;
}
interface ProjectModel {
  project: string;
  frames: { framework: string; evaluation: Evaluation }[];
  imports: string[];
  importHashes: Record<string, string>;
  allProjects: string;
}
export interface ProbeResult {
  status: "compatible" | "incompatible" | "unverified";
  diagnostics: string[];
  affectedProjects: string[];
  frameworks: string[];
  importedInputs: string[];
  sandboxRoot: string | null;
  sandboxRemoved: boolean;
}

const excluded = new Set(["bin", "obj", "packages", "producer"]);
const properties = [
  "TargetFramework",
  "TargetFrameworks",
  "MSBuildAllProjects",
  "ManagePackageVersionsCentrally",
  "MSBuildProjectDirectory",
  "MSBuildSDKsPath",
  "MSBuildToolsPath",
  "MSBuildProjectExtensionsPath",
  "BaseIntermediateOutputPath",
  "OutputPath",
  "RestorePackagesPath",
  "RestoreLockedMode",
  "RestorePackagesWithLockFile",
  "NuGetLockFilePath",
];
properties.push(
  "ProjectAssetsFile",
  "RestoreOutputPath",
  "RestoreGraphOutputPath",
  "BaseOutputPath",
  "IntermediateOutputPath",
  "RuntimeIdentifier",
  "RuntimeIdentifiers",
  "AssetTargetFallback",
  "PackageTargetFallback",
  "RestoreSources",
  "RestoreFallbackFolders",
  "NoWarn",
  "TreatWarningsAsErrors",
  "WarningsAsErrors",
);
properties.push("UserProfile", "NuGetPackageRoot", "NuGetPackageFolders");
const computedMetadata = new Set([
  "FullPath",
  "RootDir",
  "Filename",
  "Extension",
  "RelativeDir",
  "Directory",
  "RecursiveDir",
  "ModifiedTime",
  "CreatedTime",
  "AccessedTime",
  "DefiningProjectDirectory",
  "DefiningProjectName",
  "DefiningProjectExtension",
]);

function within(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}
async function filesIn(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (excluded.has(entry.name)) continue;
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("unverified:linked-input");
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) files.push(file);
    }
  }
  await visit(root);
  return files.sort();
}
function elements(root: XmlElement): XmlElement[] {
  return [
    root,
    ...root.children
      .filter((node): node is XmlElement => node instanceof XmlElement)
      .flatMap(elements),
  ];
}
async function preflight(root: string, files: string[]): Promise<void> {
  for (const file of files.filter((file) => file.endsWith(".nupkg"))) {
    const archive = await openPromise(file, {
      lazyEntries: true,
      autoClose: false,
    });
    try {
      for await (const entry of archive.eachEntry()) {
        if (/^build(?:Transitive|MultiTargeting)?\//i.test(entry.fileName))
          throw new Error("unverified:package-build-import");
      }
    } finally {
      archive.close();
    }
  }
  for (const file of files.filter((file) =>
    /\.(?:csproj|props|targets)$/i.test(file),
  )) {
    const text = await fs.readFile(file, "utf8");
    // The proof supports literal imports/project references and ordinary conditions.
    // Dynamic imports, property functions and custom targets require a separate design.
    const document = parseXml(text).root;
    if (
      !document ||
      (document.attributes.Sdk &&
        !["Microsoft.NET.Sdk", "Microsoft.NET.Sdk.Web"].includes(
          document.attributes.Sdk,
        ))
    )
      throw new Error("unverified:custom-sdk");
    for (const element of elements(document)) {
      if (
        [element.text, ...Object.values(element.attributes)].some((value) =>
          /\$\([^)]*\(/.test(value),
        )
      )
        throw new Error("unverified:property-function");
      const name = element.name.split(":").at(-1);
      if (name && ["Target", "UsingTask"].includes(name))
        throw new Error("unverified:custom-target");
      const reference =
        name === "Import"
          ? element.attributes.Project
          : name === "ProjectReference"
            ? element.attributes.Include
            : undefined;
      if (reference === undefined) continue;
      if (/[$@%*?]/.test(reference))
        throw new Error("unverified:dynamic-input");
      const resolved = path.resolve(
        path.dirname(file),
        reference.replaceAll("\\", "/"),
      );
      if (!within(root, resolved)) throw new Error("unverified:external-input");
      if (!files.includes(resolved))
        throw new Error("unverified:missing-input");
    }
  }
}

async function query(
  fixture: DotnetFixture,
  project: string,
  framework?: string,
): Promise<Evaluation> {
  const result = await checkedDotnet(
    fixture.cli,
    [
      "msbuild",
      project,
      "-nologo",
      `-getProperty:${properties.join(",")}`,
      "-getItem:PackageReference,PackageVersion,ProjectReference,FrameworkReference",
      ...(framework ? [`-p:TargetFramework=${framework}`] : []),
    ],
    path.dirname(project),
  );
  return JSON.parse(result.stdout) as Evaluation;
}

export async function inspectFixtureProject(
  fixture: DotnetFixture,
  project: string,
  scratch: string,
): Promise<ProjectModel> {
  const outer = await query(fixture, project);
  const frameworks = (
    outer.Properties.TargetFrameworks ||
    outer.Properties.TargetFramework ||
    ""
  )
    .split(";")
    .filter(Boolean);
  if (!frameworks.length) throw new Error("unverified:no-frameworks");
  const imports = new Set<string>();
  const frames: ProjectModel["frames"] = [];
  for (const framework of frameworks) {
    const evaluation =
      outer.Properties.TargetFramework === framework &&
      !outer.Properties.TargetFrameworks
        ? outer
        : await query(fixture, project, framework);
    frames.push({ framework, evaluation });
    const output = path.join(scratch, `preprocessed-${frames.length}.xml`);
    await checkedDotnet(
      fixture.cli,
      [
        "msbuild",
        project,
        "-nologo",
        `-p:TargetFramework=${framework}`,
        `-preprocess:${output}`,
      ],
      path.dirname(project),
    );
    for (const line of (await fs.readFile(output, "utf8")).split(/\r?\n/)) {
      const value = line.trim();
      if (path.isAbsolute(value) && /\.(?:csproj|props|targets)$/i.test(value))
        imports.add(path.normalize(value));
    }
  }
  const root = await fs.realpath(fixture.root);
  const importHashes: Record<string, string> = {};
  const sdkRoot = outer.Properties.MSBuildToolsPath!;
  const dotnetRoot = path.dirname(path.dirname(sdkRoot));
  const tools = [
    sdkRoot,
    path.join(dotnetRoot, "sdk-manifests"),
    path.join(dotnetRoot, "packs"),
  ];
  for (const file of [...imports].sort()) {
    if (!within(root, file) && !tools.some((tool) => within(tool, file)))
      throw new Error("unverified:external-import");
    const contents = await fs.readFile(file);
    let text = contents.toString("utf8");
    // NuGet emits this equivalent abbreviation in generated props on Windows.
    if (file.endsWith(".nuget.g.props"))
      text = text.replaceAll(
        "$(UserProfile)",
        outer.Properties.UserProfile ?? "$(UserProfile)",
      );
    importHashes[file] = createHash("sha256")
      .update(within(root, file) ? normalized(text, root) : contents)
      .digest("hex");
  }
  return {
    project,
    frames,
    imports: [...imports].sort(),
    importHashes,
    allProjects: outer.Properties.MSBuildAllProjects ?? "",
  };
}

function normalized(value: string, root: string): string {
  const from = root.replaceAll("\\", "/");
  const current = value.replaceAll("\\", "/");
  return current.split(from).join("$ROOT");
}
function comparable(model: ProjectModel, root: string): unknown {
  return {
    project: normalized(model.project, root),
    imports: model.imports.map((file) => normalized(file, root)).sort(),
    importHashes: Object.fromEntries(
      Object.entries(model.importHashes).map(([file, hash]) => [
        normalized(file, root),
        hash,
      ]),
    ),
    frames: model.frames.map(({ framework, evaluation }) => ({
      framework,
      // MSBuildAllProjects is an incomplete, timestamp-sensitive incremental-build hint.
      // The complete observed import paths and their hashes are compared separately.
      properties: Object.fromEntries(
        Object.entries(evaluation.Properties)
          .filter(([key]) => key !== "MSBuildAllProjects")
          .map(([key, value]) => [key, normalized(value, root)]),
      ),
      items: Object.fromEntries(
        Object.entries(evaluation.Items).map(([key, items]) => [
          key,
          items
            .map((item) =>
              Object.fromEntries(
                Object.entries(item)
                  .filter(([name]) => !computedMetadata.has(name))
                  .map(([name, value]) => [name, normalized(value, root)]),
              ),
            )
            .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
        ]),
      ),
    })),
  };
}

function differences(a: unknown, b: unknown, prefix = ""): string[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (a && b && typeof a === "object" && typeof b === "object") {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].flatMap(
      (key) => differences(left[key], right[key], `${prefix}/${key}`),
    );
  }
  return [`${prefix}: ${JSON.stringify(a)} => ${JSON.stringify(b)}`];
}

function demoDeclarations(model: ProjectModel): string[] {
  return [
    ...new Set(
      model.frames.flatMap(({ evaluation }) => {
        const central =
          evaluation.Properties.ManagePackageVersionsCentrally?.toLowerCase() ===
          "true";
        return (
          evaluation.Items[central ? "PackageVersion" : "PackageReference"] ??
          []
        )
          .filter((item) => item.Identity?.toLowerCase() === "demo")
          .map((item) => item.DefiningProjectFullPath!)
          .filter(Boolean);
      }),
    ),
  ];
}
function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function assertOutputPaths(
  evaluation: Evaluation,
  root: string,
  project: string,
): void {
  for (const name of [
    "MSBuildProjectExtensionsPath",
    "BaseIntermediateOutputPath",
    "IntermediateOutputPath",
    "OutputPath",
    "BaseOutputPath",
    "RestoreOutputPath",
    "RestoreGraphOutputPath",
    "RestorePackagesPath",
    "NuGetLockFilePath",
    "ProjectAssetsFile",
  ]) {
    const value = evaluation.Properties[name];
    if (value && !within(root, path.resolve(path.dirname(project), value)))
      throw new Error("unverified:external-output");
  }
}

/** Closed-world experiment. Only the generated fixture's known input tree is supported. */
export async function probeFixture(
  fixture: DotnetFixture,
  version: string,
  options: {
    signal?: AbortSignal;
    onRestoreStarted?: () => void;
  } = {},
): Promise<ProbeResult> {
  const result: ProbeResult = {
    status: "unverified",
    diagnostics: [],
    affectedProjects: [],
    frameworks: [],
    importedInputs: [],
    sandboxRoot: null,
    sandboxRemoved: true,
  };
  let scratch: string | undefined;
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(90_000)])
    : AbortSignal.timeout(90_000);
  try {
    signal.throwIfAborted();
    const originalRoot = await fs.realpath(fixture.root);
    const originalProject = await fs.realpath(fixture.projectPath);
    const files = await filesIn(originalRoot);
    await preflight(originalRoot, files);
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), "nuget-probe-analysis-"));
    const models: ProjectModel[] = [];
    for (const project of files.filter((file) => file.endsWith(".csproj"))) {
      signal.throwIfAborted();
      models.push(await inspectFixtureProject(fixture, project, scratch));
    }
    const selected = models.find((model) => model.project === originalProject);
    if (!selected) throw new Error("unverified:missing-project");
    const declarations = demoDeclarations(selected);
    if (!declarations.length) throw new Error("unverified:no-demo-reference");
    const affected = models.filter((model) =>
      demoDeclarations(model).some((file) => declarations.includes(file)),
    );
    result.affectedProjects = affected.map((model) =>
      path.relative(originalRoot, model.project).replaceAll("\\", "/"),
    );
    result.importedInputs = [
      ...new Set(
        models.flatMap((model) =>
          model.imports.filter((file) => within(originalRoot, file)),
        ),
      ),
    ]
      .map((file) => path.relative(originalRoot, file).replaceAll("\\", "/"))
      .sort();
    result.sandboxRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "nuget-probe-copy-"),
    );
    result.sandboxRemoved = false;
    const copyRoot = await fs.realpath(result.sandboxRoot);
    await fs.cp(originalRoot, copyRoot, {
      recursive: true,
      filter: (file) =>
        !path
          .relative(originalRoot, file)
          .split(path.sep)
          .some((part) => excluded.has(part)),
    });
    for (const config of files.filter(
      (file) => path.basename(file).toLowerCase() === "nuget.config",
    )) {
      const destination = path.join(
        copyRoot,
        path.relative(originalRoot, config),
      );
      let text = await fs.readFile(destination, "utf8");
      // Fixture-only rebasing of the two known local paths; not a general XML editor.
      for (const alias of [fixture.root, originalRoot])
        text = text.split(xml(alias)).join(xml(copyRoot));
      await fs.writeFile(destination, text);
    }
    const copyFixture = {
      ...fixture,
      root: copyRoot,
      cli: fixtureCli(copyRoot),
    };
    const copyProject = (model: ProjectModel) =>
      path.join(copyRoot, path.relative(originalRoot, model.project));
    // Recreate generated imports for warm projects; never copy old obj paths into restores.
    for (const model of models) {
      const assets = path.join(
        path.dirname(model.project),
        "obj",
        "project.assets.json",
      );
      if (
        await fs.stat(assets).then(
          () => true,
          () => false,
        )
      ) {
        const project = copyProject(model);
        for (const frame of model.frames)
          assertOutputPaths(
            await query(copyFixture, project, frame.framework),
            copyRoot,
            project,
          );
        await checkedDotnet(
          copyFixture.cli,
          [
            "restore",
            project,
            "--configfile",
            path.join(copyRoot, "NuGet.Config"),
          ],
          path.dirname(project),
        );
      }
    }
    for (const model of models) {
      signal.throwIfAborted();
      const copy = await inspectFixtureProject(
        copyFixture,
        copyProject(model),
        scratch,
      );
      for (const { evaluation } of copy.frames) {
        assertOutputPaths(evaluation, copyRoot, copy.project);
      }
      if (
        JSON.stringify(comparable(model, originalRoot)) !==
        JSON.stringify(comparable(copy, copyRoot))
      ) {
        console.info(
          JSON.stringify({
            evaluationDifferences: differences(
              comparable(model, originalRoot),
              comparable(copy, copyRoot),
            ).slice(0, 10),
          }),
        );
        throw new Error("unverified:evaluation-changed");
      }
    }
    const changes: VersionDeclarationChange[] = selected.frames.flatMap(
      ({ evaluation }) => {
        const kind =
          evaluation.Properties.ManagePackageVersionsCentrally?.toLowerCase() ===
          "true"
            ? "PackageVersion"
            : "PackageReference";
        return (evaluation.Items[kind] ?? [])
          .filter((item) => item.Identity?.toLowerCase() === "demo")
          .map((item) => ({
            declarationPath: item.DefiningProjectFullPath!,
            kind,
            packageId: item.Identity!,
            expectedVersion: item.Version!,
            version,
            affectedProjectPaths: affected.map((model) => model.project),
          }));
      },
    );
    const documents = [];
    const fileMap = new Map<string, string>();
    for (const file of declarations) {
      if (!within(originalRoot, file))
        throw new Error("unverified:external-declaration");
      documents.push({ path: file, text: await fs.readFile(file, "utf8") });
      fileMap.set(file, path.join(copyRoot, path.relative(originalRoot, file)));
    }
    const contextRevision = createHash("sha256")
      .update(
        JSON.stringify(models.map((model) => comparable(model, originalRoot))),
      )
      .digest("hex");
    const plan = createVersionEditPlan({
      documents,
      changes,
      contextRevision,
      // The generated fixture explicitly selects its complete consumer scope.
      selectedProjectPaths: affected.map((model) => model.project),
    });
    await applyVersionEditPlan(plan, {
      contextRevision,
      fileMap,
      io: {
        async read(file) {
          if (!within(copyRoot, file))
            throw new Error("unverified:external-write");
          return { path: file, text: await fs.readFile(file, "utf8") };
        },
        async writeIfUnchanged(expected, replacement) {
          // Controlled single-writer temporary files only; O3 supplies the editor-aware host writer.
          if (!within(copyRoot, expected.path))
            throw new Error("unverified:external-write");
          if ((await fs.readFile(expected.path, "utf8")) !== expected.text)
            throw new VersionEditError("stale-document", "The copy changed.");
          await fs.writeFile(expected.path, replacement, "utf8");
        },
      },
    });
    for (const model of affected) {
      signal.throwIfAborted();
      const project = copyProject(model);
      for (const frame of model.frames)
        assertOutputPaths(
          await query(copyFixture, project, frame.framework),
          copyRoot,
          project,
        );
      const pending = copyFixture.cli.runDotnet(
        [
          "restore",
          project,
          "--configfile",
          path.join(copyRoot, "NuGet.Config"),
        ],
        path.dirname(project),
        { signal },
      );
      options.onRestoreStarted?.();
      const restore = await pending;
      const diagnostics = `${restore.stdout}\n${restore.stderr}`;
      const assetFile = path.join(
        path.dirname(project),
        "obj",
        "project.assets.json",
      );
      const assets = await fs.readFile(assetFile, "utf8").then(
        (text) => JSON.parse(text) as { logs?: { code: string }[] },
        () => undefined,
      );
      const codes = [
        ...new Set([
          ...(diagnostics.match(/NU[0-9]{4}/g) ?? []),
          ...(assets?.logs?.map((log) => log.code) ?? []),
        ]),
      ];
      if (
        codes.some((code) =>
          ["NU1202", "NU1605", "NU1608", "NU1701", "NU1107"].includes(code),
        )
      ) {
        result.status = "incompatible";
        result.diagnostics = codes;
        return result;
      }
      if (restore.code !== 0 || codes.includes("NU1004")) {
        result.diagnostics = codes.length ? codes : ["restore-failed"];
        return result;
      }
      const sdk = {
        version: fixture.sdkVersion,
        major: Number(fixture.sdkVersion.split(".")[0]),
        cwd: path.dirname(project),
      };
      const listed = await checkedDotnet(
        copyFixture.cli,
        dotnetArguments(sdk, {
          kind: "list",
          projectPath: project,
          outdated: false,
          noRestore: sdk.major >= 10,
        }),
        sdk.cwd,
      );
      const frameworks =
        (JSON.parse(listed.stdout) as DotnetPackageList).projects?.[0]
          ?.frameworks ?? [];
      if (frameworks.length !== model.frames.length)
        throw new Error("unverified:frameworks-changed");
      for (const frame of model.frames) {
        const framework = frameworks.find(
          (item) => item.framework === frame.framework,
        );
        const expected = frame.evaluation.Items.PackageReference?.some(
          (item) => item.Identity?.toLowerCase() === "demo",
        );
        if (
          !framework ||
          (expected &&
            !framework.topLevelPackages?.some(
              (item) =>
                item.id.toLowerCase() === "demo" &&
                item.resolvedVersion &&
                sameNuGetVersion(item.resolvedVersion, version),
            ))
        ) {
          throw new Error("unverified:resolved-version-mismatch");
        }
        result.frameworks.push(
          `${path.relative(originalRoot, model.project)}:${frame.framework}`,
        );
      }
    }
    signal.throwIfAborted();
    result.status = "compatible";
    return result;
  } catch (error) {
    result.diagnostics = [
      signal.aborted
        ? "cancelled"
        : error instanceof Error
          ? error.message
          : String(error),
    ];
    return result;
  } finally {
    if (scratch)
      await fs.rm(scratch, { recursive: true, force: true, maxRetries: 5 });
    if (result.sandboxRoot) {
      await fs.rm(result.sandboxRoot, {
        recursive: true,
        force: true,
        maxRetries: 5,
      });
      result.sandboxRemoved = true;
    }
  }
}
