import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { expect, it } from "vitest";
import type {
  PlannedCompatibilityEvidence,
  UpgradeCandidate,
} from "#contracts";
import { candidateKey } from "#manager";
import { evaluateProject } from "./project-evaluation";
import {
  prepareCompatibilityRequest,
  verifyPackageCompatibility,
  compatibilityRequestKey,
} from "./package-compatibility";
import { CompatibilityQueue } from "./compatibility-queue";
import {
  checkedDotnet,
  createDotnetFixture,
  snapshotTree,
} from "./test/dotnet-fixture";

it.each(["simple", "multi", "imports", "central"] as const)(
  "verifies the exact edit plan in a real %s project without changing originals",
  async (layout) => {
    const fixture = await createDotnetFixture({
      sdkMajor: Number(process.env.SDK_MAJOR),
      layout,
    });
    try {
      if (layout === "simple" || layout === "multi") {
        const text = await fs.readFile(fixture.projectPath, "utf8");
        await fs.writeFile(
          fixture.projectPath,
          text.replace(
            "</Project>",
            '<ItemGroup><PackageReference Include="Demo" Version="1.0.0"/></ItemGroup></Project>',
          ),
        );
      }
      if (layout === "central") {
        const other = path.join(fixture.root, "Other", "Other.csproj");
        await fs.writeFile(
          other,
          (await fs.readFile(other, "utf8")).replace(
            /net\d+\.0/,
            "netstandard2.1",
          ),
        );
      }
      // A higher package deliberately lacks netstandard assets; the second central consumer must fail.
      const producer = path.join(fixture.root, "producer", "Demo.csproj");
      await fs.writeFile(
        producer,
        (await fs.readFile(producer, "utf8")).replace(
          "netstandard2.1",
          `net${process.env.SDK_MAJOR}.0`,
        ),
      );
      await checkedDotnet(
        fixture.cli,
        [
          "pack",
          producer,
          "--output",
          fixture.feedPath,
          "-p:PackageVersion=3.0.0",
          "--verbosity",
          "quiet",
        ],
        path.dirname(producer),
      );
      await checkedDotnet(
        fixture.cli,
        [
          "restore",
          fixture.projectPath,
          "--configfile",
          path.join(fixture.root, "NuGet.Config"),
        ],
        path.dirname(fixture.projectPath),
      );
      const before = await snapshotTree(fixture.root);
      const project = await evaluateProject(fixture.cli, {
        projectPath: fixture.projectPath,
        allowedRoots: [fixture.root],
        restoreConfigPath: path.join(fixture.root, "NuGet.Config"),
        sourceRevision: "local",
        feedUrls: [fixture.feedPath],
      });
      expect(project.isolation).toEqual({ supported: true, reasons: [] });
      const references = project.references.filter(
        (reference) =>
          reference.packageId.toLowerCase() === "demo" && reference.direct,
      );
      const candidate: UpgradeCandidate = {
        key: "",
        projectPath: project.projectPath,
        packageId: "Demo",
        referenceIds: references.map((reference) => reference.referenceId),
        version: "1.5.0",
        feedUrls: project.feedUrls,
        compatibility: {
          status: "unverified",
          reason: "pending",
          diagnostics: [],
        },
      };
      const prepare = (version: string) => {
        const next = { ...candidate, version };
        next.key = candidateKey(next);
        return prepareCompatibilityRequest({
          project,
          candidate: next,
          feedUrls: project.feedUrls,
          selectedProjectPaths: project.projects.map((node) => node.path),
        });
      };
      const request = await prepare("1.5.0");
      const queue = new CompatibilityQueue<PlannedCompatibilityEvidence>();
      let executions = 0;
      const work = (signal: AbortSignal) => {
        executions++;
        return verifyPackageCompatibility(fixture.cli, request, signal);
      };
      const [result, shared] = await Promise.all([
        queue.request(compatibilityRequestKey(request), 1, work),
        queue.request(compatibilityRequestKey(request), 5, work),
      ]).finally(() => queue.dispose());
      expect(shared).toBe(result);
      expect(executions).toBe(1);
      expect(result, JSON.stringify(result.result)).toMatchObject({
        contextRevision: project.contextRevision,
        candidateKey: request.candidate.key,
        planRevision: request.planRevision,
        result: { status: "compatible" },
      });
      if (layout === "multi" || layout === "central") {
        const incompatible = await verifyPackageCompatibility(
          fixture.cli,
          await prepare("3.0.0"),
        );
        expect(incompatible.result).toMatchObject({
          status: "incompatible",
          diagnostics: expect.arrayContaining(["NU1202"]),
        });
      }
      expect(await snapshotTree(fixture.root)).toEqual(before);
    } finally {
      await fixture.dispose();
    }
  },
);

it("distinguishes real fallback/dependency diagnostics from locked or unavailable packages", async () => {
  const fixture = await createDotnetFixture({
    sdkMajor: Number(process.env.SDK_MAJOR),
    layout: "simple",
  });
  try {
    const producer = path.join(fixture.root, "producer", "Demo.csproj");
    const nuspec = path.join(fixture.root, "producer", "scenario.nuspec");
    const pack = async (
      id: string,
      version: string,
      dependency = "",
      framework = "netstandard2.1",
    ) => {
      await fs.writeFile(
        nuspec,
        `<?xml version="1.0"?><package><metadata><id>${id}</id><version>${version}</version><authors>Test</authors><description>Fixture</description>${dependency ? `<dependencies>${dependency}</dependencies>` : ""}</metadata><files><file src="bin/Release/netstandard2.1/Demo.dll" target="lib/${framework}"/></files></package>`,
      );
      await checkedDotnet(
        fixture.cli,
        [
          "pack",
          producer,
          "--output",
          fixture.feedPath,
          `-p:NuspecFile=${nuspec}`,
          `-p:PackageId=${id}`,
          `-p:PackageVersion=${version}`,
          "--verbosity",
          "quiet",
        ],
        path.dirname(producer),
      );
      expect(await fs.readdir(fixture.feedPath)).toContain(
        `${id}.${version}.nupkg`,
      );
    };
    await pack("Demo", "4.0.0", "", "net472");
    await pack("Shared", "1.0.0");
    await pack("Shared", "2.0.0");
    await pack("Demo", "5.0.0", '<dependency id="Shared" version="[2.0.0]"/>');
    const base = (await fs.readFile(fixture.projectPath, "utf8")).replace(
      "</Project>",
      '<ItemGroup><PackageReference Include="Demo" Version="1.0.0"/><PackageReference Include="Shared" Version="1.0.0"/></ItemGroup></Project>',
    );
    await fs.writeFile(fixture.projectPath, base);
    let feeds = [fixture.feedPath];
    const evaluate = () =>
      evaluateProject(fixture.cli, {
        projectPath: fixture.projectPath,
        allowedRoots: [fixture.root],
        restoreConfigPath: path.join(fixture.root, "NuGet.Config"),
        feedUrls: feeds,
        sourceRevision: "local",
      });
    const check = async (version: string) => {
      const project = await evaluate();
      const candidate: UpgradeCandidate = {
        key: "",
        packageId: "Demo",
        version,
        projectPath: project.projectPath,
        referenceIds: project.references
          .filter(
            (reference) =>
              reference.packageId.toLowerCase() === "demo" && reference.direct,
          )
          .map((reference) => reference.referenceId),
        feedUrls: [fixture.feedPath],
        compatibility: {
          status: "unverified",
          reason: "pending",
          diagnostics: [],
        },
      };
      candidate.key = candidateKey(candidate);
      const before = await snapshotTree(fixture.root);
      const result = await verifyPackageCompatibility(
        fixture.cli,
        await prepareCompatibilityRequest({
          project,
          candidate,
          feedUrls: project.feedUrls,
          selectedProjectPaths: [project.projectPath],
        }),
      );
      expect(await snapshotTree(fixture.root)).toEqual(before);
      return result.result;
    };
    expect(await check("4.0.0")).toMatchObject({
      status: "incompatible",
      diagnostics: expect.arrayContaining(["NU1701"]),
    });
    expect(await check("5.0.0")).toMatchObject({
      status: "incompatible",
      diagnostics: expect.arrayContaining(["NU1605"]),
    });
    expect(await check("9.0.0")).toMatchObject({ status: "unverified" });
    const dependencies = path.join(fixture.root, "dependency-feed");
    await fs.mkdir(dependencies);
    for (const version of ["1.0.0", "2.0.0"])
      await fs.rename(
        path.join(fixture.feedPath, `Shared.${version}.nupkg`),
        path.join(dependencies, `Shared.${version}.nupkg`),
      );
    feeds = [fixture.feedPath, dependencies];
    await fs.writeFile(
      path.join(fixture.root, "NuGet.Config"),
      `<configuration><packageSources><clear/><add key="target" value="${fixture.feedPath}"/><add key="dependencies" value="${dependencies}"/></packageSources><config><add key="globalPackagesFolder" value="${path.join(fixture.root, "packages")}"/></config></configuration>`,
    );
    expect(await check("1.5.0")).toMatchObject({ status: "compatible" });
    await fs.rename(
      path.join(fixture.feedPath, "Demo.1.5.0.nupkg"),
      path.join(dependencies, "Demo.1.5.0.nupkg"),
    );
    expect(await check("1.5.0")).toMatchObject({ status: "unverified" });
    await fs.rename(
      path.join(dependencies, "Demo.1.5.0.nupkg"),
      path.join(fixture.feedPath, "Demo.1.5.0.nupkg"),
    );
    await fs.writeFile(
      fixture.projectPath,
      base.replace(
        "</PropertyGroup>",
        "<RestorePackagesWithLockFile>true</RestorePackagesWithLockFile></PropertyGroup>",
      ),
    );
    await checkedDotnet(
      fixture.cli,
      [
        "restore",
        fixture.projectPath,
        "--configfile",
        path.join(fixture.root, "NuGet.Config"),
      ],
      path.dirname(fixture.projectPath),
    );
    await fs.writeFile(
      fixture.projectPath,
      (await fs.readFile(fixture.projectPath, "utf8")).replace(
        "</PropertyGroup>",
        "<RestoreLockedMode>true</RestoreLockedMode></PropertyGroup>",
      ),
    );
    expect(await check("1.5.0")).toMatchObject({
      status: "unverified",
      diagnostics: expect.arrayContaining(["NU1004"]),
    });
  } finally {
    await fixture.dispose();
  }
});

it("keeps HTTP authentication failure unverified and cancels a real restore cleanly", async () => {
  const fixture = await createDotnetFixture({
    sdkMajor: Number(process.env.SDK_MAJOR),
    layout: "simple",
  });
  const server = http.createServer((_request, response) => {
    response.writeHead(401);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as { port: number };
    const remote = `http://127.0.0.1:${address.port}/v3/index.json`;
    const config = path.join(fixture.root, "NuGet.Config");
    // A cold project avoids any baseline restore of Demo before the candidate attempt.
    await fs.writeFile(
      fixture.projectPath,
      (await fs.readFile(fixture.projectPath, "utf8")).replace(
        "</Project>",
        '<ItemGroup><PackageReference Include="Demo" Version="1.0.0"/></ItemGroup></Project>',
      ),
    );
    await fs.writeFile(
      config,
      `<configuration><packageSources><clear/><add key="remote" value="${remote}" allowInsecureConnections="true"/></packageSources></configuration>`,
    );
    const project = await evaluateProject(fixture.cli, {
      projectPath: fixture.projectPath,
      allowedRoots: [fixture.root],
      restoreConfigPath: config,
      feedUrls: [remote],
      sourceRevision: "remote",
    });
    const candidate: UpgradeCandidate = {
      key: "",
      packageId: "Demo",
      version: "1.5.0",
      projectPath: project.projectPath,
      referenceIds: project.references
        .filter((reference) => reference.packageId.toLowerCase() === "demo")
        .map((reference) => reference.referenceId),
      feedUrls: [remote],
      compatibility: {
        status: "unverified",
        reason: "pending",
        diagnostics: [],
      },
    };
    candidate.key = candidateKey(candidate);
    const request = await prepareCompatibilityRequest({
      project,
      candidate,
      selectedProjectPaths: [project.projectPath],
      feedUrls: [remote],
    });
    const before = await snapshotTree(fixture.root);
    expect(
      (await verifyPackageCompatibility(fixture.cli, request)).result,
    ).toMatchObject({ status: "unverified" });
    const controller = new AbortController();
    const original = fixture.cli.runDotnet.bind(fixture.cli);
    let root: string | undefined;
    fixture.cli.runDotnet = (args, cwd, options) => {
      const pending = original(args, cwd, options);
      if (args[0] === "restore" && args[1]?.endsWith("App.csproj")) {
        root = path.dirname(args[args.indexOf("--packages") + 1]!);
        controller.abort();
      }
      return pending;
    };
    expect(
      (
        await verifyPackageCompatibility(
          fixture.cli,
          request,
          controller.signal,
        )
      ).result,
    ).toMatchObject({ status: "unverified", reason: "cancelled" });
    expect(root).toBeDefined();
    await expect(fs.stat(root!)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await snapshotTree(fixture.root)).toEqual(before);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await fixture.dispose();
  }
});
