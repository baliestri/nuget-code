import fs from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import {
  PackageDataAdapter,
  type DataEnvironment,
} from "#extension/webview/package-data-adapter";
import { PackageDataService } from "#extension/webview/package-data-service";
import type { UpdateProjection } from "#contracts";
import {
  checkedDotnet,
  createDotnetFixture,
  snapshotTree,
} from "#client/test/dotnet-fixture";

it("projects real central-package candidates with separate selection and project proof revisions", async () => {
  const fixture = await createDotnetFixture({
    sdkMajor: Number(process.env.SDK_MAJOR),
    layout: "central",
  });
  const paths = [
    fixture.projectPath,
    path.join(fixture.root, "Other", "Other.csproj"),
  ];
  const logger = {
    verbose: () => {},
    information: () => {},
    warning: () => {},
    error: () => {},
  };
  const environment: DataEnvironment = {
    target: {
      id: "solution",
      name: "Solution",
      kind: "solution",
      path: path.join(fixture.root, "App.sln"),
      projectPaths: paths,
    },
    feeds: [
      { id: "local", name: "Local", enabled: true, url: fixture.feedPath },
    ],
    configPaths: [path.join(fixture.root, "NuGet.Config")],
    allowedRoots: [fixture.root],
    cli: fixture.cli,
    settings: {
      dotnetPath: "dotnet",
      nugetPath: "nuget",
      proxy: "",
      maxSearchResults: 100,
      credentialProviderPaths: [],
      extraConfigPaths: [],
    } as DataEnvironment["settings"],
    sourceRevision: "source",
  };
  const adapter = new PackageDataAdapter(() => environment, logger as never);
  let resolve!: (value: UpdateProjection) => void;
  let reject!: (error: Error) => void;
  const done = new Promise<UpdateProjection>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const service = new PackageDataService(
    adapter,
    (projection) => {
      if (
        projection.evaluation.candidates.length === 2 &&
        projection.evaluation.candidates.every(
          (candidate) => candidate.compatibility.status === "compatible",
        )
      )
        resolve(projection);
      else if (
        projection.evaluation.candidates.some(
          (candidate) =>
            candidate.compatibility.status === "unverified" &&
            candidate.compatibility.reason !== "compatibility-not-verified",
        )
      )
        reject(new Error(JSON.stringify(projection.evaluation)));
    },
    {
      flow: (_flow, value) => {
        if (value.status === "failed")
          reject(new Error(value.error ?? "load failed"));
      },
    },
  );
  // Attach a rejection handler during fixture setup so diagnostic failures are never unhandled.
  void done.catch(() => {});
  try {
    await fs.writeFile(environment.target!.path, "fixture solution identity");
    for (const project of paths)
      await checkedDotnet(
        fixture.cli,
        ["restore", project, "--configfile", environment.configPaths[0]!],
        path.dirname(project),
      );
    const before = await snapshotTree(fixture.root);
    service.setContext({
      targetId: "solution",
      projectPaths: paths,
      feedUrls: [fixture.feedPath],
      includePrerelease: false,
      revision: "selection",
    });
    await service.refresh({ force: true });
    const projection = await done;
    for (const candidate of projection.evaluation.candidates) {
      expect(candidate.version).toBe("1.5.0");
      const request = service.getVerifiedRequest(candidate.key)!;
      expect(request).toBeDefined();
      expect(request.plan.contextRevision).toBe(
        request.project.contextRevision,
      );
      expect(request.project.contextRevision).not.toBe(
        projection.context.revision,
      );
      expect(request.plan.changes[0]?.affectedProjectPaths).toHaveLength(2);
    }
    expect(await snapshotTree(fixture.root)).toEqual(before);
  } finally {
    service.dispose();
    adapter.dispose();
    await fixture.dispose();
  }
});
