import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { candidateKey } from "#manager";
import type { UpgradeCandidate } from "#contracts";
import { evaluateProject } from "./project-evaluation";
import { contextFixture } from "./test/project-context-fixture";
import {
  classifyRestore,
  prepareCompatibilityRequest,
  verifyPackageCompatibility,
} from "./package-compatibility";

const restored = {
  exitCode: 0,
  diagnostics: [],
  resolvedVersions: ["1.5.0"],
  requestedVersion: "1.5.0",
  expectedFrameworks: ["net8.0"],
  restoredFrameworks: ["net8.0"],
};

describe("restore evidence", () => {
  it.each(["NU1202", "NU1605", "NU1608", "NU1701", "NU1107"])(
    "does not accept %s even with exit code zero",
    (code) => {
      expect(
        classifyRestore({
          ...restored,
          diagnostics: [{ code, message: "secret path" }],
        }).status,
      ).toBe("incompatible");
    },
  );
  it("gives incomplete infrastructure evidence precedence over incompatibility", () => {
    expect(
      classifyRestore({
        ...restored,
        exitCode: 1,
        diagnostics: [
          { code: "NU1202", message: "fallback" },
          {
            code: "NU1301",
            message: "https://user:password@example.test?token=secret",
          },
        ],
      }),
    ).toMatchObject({
      status: "unverified",
      diagnostics: ["NU1202", "NU1301"],
    });
  });
  it.each(["NU1004", "NU1102", "NU1301", "NU9999"])(
    "does not interpret %s as incompatibility",
    (code) => {
      expect(
        classifyRestore({
          ...restored,
          diagnostics: [{ code, message: "sensitive" }],
        }).status,
      ).toBe("unverified");
    },
  );
  it("requires every framework and the exact normalized version", () => {
    expect(classifyRestore(restored).status).toBe("compatible");
    expect(
      classifyRestore({ ...restored, resolvedVersions: ["01.5.0.0+build"] })
        .status,
    ).toBe("compatible");
    expect(
      classifyRestore({ ...restored, resolvedVersions: ["1.6.0"] }).status,
    ).toBe("unverified");
    expect(classifyRestore({ ...restored, resolvedVersions: [] }).status).toBe(
      "unverified",
    );
    expect(
      classifyRestore({ ...restored, restoredFrameworks: [] }).status,
    ).toBe("unverified");
    expect(classifyRestore({ ...restored, exitCode: null }).status).toBe(
      "unverified",
    );
  });
});

describe("host-prepared compatibility intent", () => {
  it("requires explicit selection of every shared consumer and binds the plan", async () => {
    const fixture = await contextFixture(true);
    try {
      const project = await evaluateProject(fixture.cli, fixture.options);
      const candidate: UpgradeCandidate = {
        key: "",
        packageId: "Demo",
        projectPath: project.projectPath,
        referenceIds: project.references.map(
          (reference) => reference.referenceId,
        ),
        version: "1.5.0",
        feedUrls: fixture.options.feedUrls,
        compatibility: {
          status: "unverified",
          reason: "pending",
          diagnostics: [],
        },
      };
      candidate.key = candidateKey(candidate);
      const options = { project, candidate, feedUrls: project.feedUrls };
      await expect(
        prepareCompatibilityRequest({
          ...options,
          selectedProjectPaths: [project.projectPath],
        }),
      ).rejects.toMatchObject({ code: "scope-mismatch" });
      const request = await prepareCompatibilityRequest({
        ...options,
        selectedProjectPaths: fixture.projects,
      });
      expect(request.plan.changes[0]?.affectedProjectPaths).toEqual(
        fixture.projects,
      );
      expect(request.planRevision).toMatch(/^[a-f0-9]{64}$/);
      await expect(
        prepareCompatibilityRequest({
          ...request,
          project: {
            ...project,
            projects: project.projects.map((node) => ({
              ...node,
              frames: node.frames.map((frame) => ({
                ...frame,
                properties: {
                  ...frame.properties,
                  CentralPackageTransitivePinningEnabled: "true",
                },
              })),
            })),
          },
        }),
      ).rejects.toMatchObject({ code: "unsupported-context" });
      const changed = {
        ...request,
        candidate: { ...candidate, version: "2.0.0" },
      };
      expect(
        (await verifyPackageCompatibility(fixture.cli, changed)).result.status,
      ).toBe("unverified");
      const cancelled = await verifyPackageCompatibility(
        fixture.cli,
        request,
        AbortSignal.abort(),
      );
      expect(cancelled).toMatchObject({
        candidateKey: candidate.key,
        planRevision: request.planRevision,
        contextRevision: project.contextRevision,
        result: { status: "unverified", reason: "cancelled" },
      });
      await fs.appendFile(project.projectPath, "\n<!-- changed -->");
      expect(
        (await verifyPackageCompatibility(fixture.cli, request)).result.status,
      ).toBe("unverified");
    } finally {
      await fixture.dispose();
    }
  });
});

it.each([
  ["success", "compatible"],
  ["wrong-version", "unverified"],
  ["missing-framework", "unverified"],
  ["wrong-source", "unverified"],
  ["wrong-source-incompatible", "unverified"],
  ["wrong-version-incompatible", "unverified"],
  ["network", "unverified"],
  ["cancelled", "unverified"],
  ["package-build", "unverified"],
  ["malformed-assets", "unverified"],
] as const)(
  "handles %s and always removes the private copy",
  async (scenario, status) => {
    const fixture = await contextFixture();
    try {
      await fs.mkdir(fixture.options.feedUrls[0]!);
      const project = await evaluateProject(fixture.cli, fixture.options);
      const candidate: UpgradeCandidate = {
        key: "",
        packageId: "Demo",
        projectPath: project.projectPath,
        referenceIds: project.references
          .filter((reference) => reference.projectPath === project.projectPath)
          .map((reference) => reference.referenceId),
        version: "1.5.0",
        feedUrls: project.feedUrls,
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
        feedUrls: project.feedUrls,
      });
      const controller = new AbortController();
      const original = await fs.readFile(project.projectPath);
      const run = fixture.runDotnet.getMockImplementation()!;
      let root: string | undefined;
      fixture.runDotnet.mockImplementation(async (args, cwd, options) => {
        if (args[0] !== "restore") return run(args, cwd, options);
        const packages = args[args.indexOf("--packages") + 1]!;
        root = path.dirname(packages);
        if (scenario === "cancelled") {
          controller.abort();
          options?.signal?.throwIfAborted();
        }
        if (scenario === "network")
          return {
            code: 1,
            stdout:
              "NU1301 https://user:password@example.test?secret=value\nNU1202",
            stderr: "",
          };
        const obj = path.join(path.dirname(args[1]!), "obj");
        await fs.mkdir(obj, { recursive: true });
        const version = scenario.startsWith("wrong-version")
          ? "1.6.0"
          : "1.5.0";
        const asset = {
          targets:
            scenario === "missing-framework"
              ? {}
              : { "net8.0": { [`Demo/${version}`]: { type: "package" } } },
          libraries: {
            [`Demo/${version}`]: {
              type: "package",
              path: `demo/${version}`,
              files:
                scenario === "package-build"
                  ? ["build/Demo.targets"]
                  : ["lib/net8.0/Demo.dll"],
            },
          },
        };
        await fs.writeFile(
          path.join(obj, "project.assets.json"),
          scenario === "malformed-assets" ? "{" : JSON.stringify(asset),
        );
        await fs.mkdir(path.join(packages, "demo", version), {
          recursive: true,
        });
        await fs.writeFile(
          path.join(packages, "demo", version, ".nupkg.metadata"),
          JSON.stringify({
            source: scenario.startsWith("wrong-source")
              ? "https://wrong.test"
              : project.feedUrls[0],
          }),
        );
        return {
          code: 0,
          stdout: scenario.endsWith("-incompatible") ? "NU1202" : "",
          stderr: "",
        };
      });
      const result = await verifyPackageCompatibility(
        fixture.cli,
        request,
        controller.signal,
      );
      expect(result.result, JSON.stringify(result.result)).toMatchObject({
        status,
      });
      expect(JSON.stringify(result.result)).not.toContain("password");
      expect(root).toBeDefined();
      await expect(fs.stat(root!)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await fs.readFile(project.projectPath)).toEqual(original);
    } finally {
      await fixture.dispose();
    }
  },
  15_000,
);
