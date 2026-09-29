import { describe, expect, it } from "vitest";
import type {
  CompatibilityResult,
  InstalledReference,
  UpgradeInput,
} from "#contracts";
import {
  candidateKey,
  evaluateUpgrades,
  executableCandidates,
} from "./upgrade-policy";

const source = "https://feed.test/index.json";
function reference(
  overrides: Partial<InstalledReference> = {},
): InstalledReference {
  return {
    referenceId: "a-net8",
    packageId: "Demo",
    projectPath: "/a.csproj",
    framework: "net8.0",
    requestedVersion: "1.0.0",
    resolvedVersion: "1.0.0",
    direct: true,
    declarationPath: "/a.csproj",
    affectedProjectPaths: ["/a.csproj"],
    ...overrides,
  };
}
function input(overrides: Partial<UpgradeInput> = {}): UpgradeInput {
  return {
    inventory: [
      reference(),
      reference({
        referenceId: "b-net8",
        projectPath: "/b.csproj",
        declarationPath: "/b.csproj",
        affectedProjectPaths: ["/b.csproj"],
        resolvedVersion: "2.0.0",
      }),
    ],
    catalogs: [
      {
        packageId: "demo",
        revision: "c1",
        complete: true,
        versions: [
          { version: "1.5.0", feedUrls: [source], listed: true },
          { version: "3.0.0-beta", feedUrls: [source], listed: true },
        ],
      },
    ],
    context: {
      targetId: "solution",
      projectPaths: ["/a.csproj", "/b.csproj"],
      feedUrls: [source],
      includePrerelease: false,
      revision: "r1",
    },
    evidence: new Map(),
    ...overrides,
  };
}
function withEvidence(
  value: UpgradeInput,
  result: CompatibilityResult,
  revision = value.context.revision,
): UpgradeInput {
  const candidates = evaluateUpgrades(value).candidates;
  return {
    ...value,
    evidence: new Map(
      candidates.map((c) => [c.key, { contextRevision: revision, result }]),
    ),
  };
}
const compatible: CompatibilityResult = {
  status: "compatible",
  diagnostics: [],
};

describe("upgrade eligibility", () => {
  it("evaluates projects independently and requires positive compatibility evidence", () => {
    const value = input();
    const evaluation = evaluateUpgrades(value);
    expect(
      evaluation.candidates.map((c) => [c.projectPath, c.version]),
    ).toEqual([["/a.csproj", "1.5.0"]]);
    expect(executableCandidates(evaluation)).toEqual([]);
    expect(
      executableCandidates(evaluateUpgrades(withEvidence(value, compatible))),
    ).toHaveLength(1);
  });

  it("excludes prereleases immediately when the preference changes", () => {
    const value = input();
    const enabled = {
      ...value,
      context: { ...value.context, includePrerelease: true },
    };
    const verified = withEvidence(enabled, compatible);
    expect(
      executableCandidates(evaluateUpgrades(verified)).map((c) => c.version),
    ).toEqual(["3.0.0-beta", "3.0.0-beta"]);
    const disabled = evaluateUpgrades({
      ...verified,
      context: { ...verified.context, includePrerelease: false },
    });
    expect(disabled.candidates.map((c) => c.version)).toEqual(["1.5.0"]);
    expect(executableCandidates(disabled)).toEqual([]);
  });

  it("does not exempt an installed preview from the stable-only policy", () => {
    const value = input({
      inventory: [reference({ resolvedVersion: "2.0.0-beta" })],
    });
    expect(evaluateUpgrades(value).candidates).toEqual([]);
  });

  it("does not reuse evidence from an older input revision", () => {
    expect(
      executableCandidates(
        evaluateUpgrades(withEvidence(input(), compatible, "old")),
      ),
    ).toEqual([]);
  });

  it("restricts versions to selected sources and preserves listing status per source", () => {
    const value = input({
      catalogs: [
        {
          packageId: "Demo",
          revision: "c",
          complete: true,
          versions: [
            {
              version: "2.0",
              feedUrls: ["https://other.test/index.json"],
              listed: true,
            },
            { version: "2.0", feedUrls: [source], listed: false },
            { version: "1.5", feedUrls: [source], listed: true },
          ],
        },
      ],
    });
    expect(
      evaluateUpgrades(value).candidates.map((c) => [c.version, c.feedUrls]),
    ).toEqual([["1.5.0", [source]]]);
    expect(
      evaluateUpgrades({
        ...value,
        context: { ...value.context, feedUrls: [] },
      }).candidates,
    ).toEqual([]);
  });

  it("never downgrades another affected framework", () => {
    const value = input({
      inventory: [
        reference(),
        reference({
          referenceId: "a-net9",
          framework: "net9.0",
          resolvedVersion: "2.0.0",
        }),
      ],
    });
    expect(evaluateUpgrades(value).candidates).toEqual([]);
  });

  it("does not recommend equivalent versions or unresolved ranges", () => {
    expect(
      evaluateUpgrades(
        input({ inventory: [reference({ resolvedVersion: "1.5+build" })] }),
      ).candidates,
    ).toEqual([]);
    const invalid = evaluateUpgrades(
      input({ inventory: [reference({ resolvedVersion: "[1,2)" })] }),
    );
    expect(invalid.candidates).toEqual([]);
    expect(invalid.blocked[0]?.reason).toBe("invalid-version");
  });

  it("does not add transitives or touch projects outside the selected target", () => {
    const value = input({
      inventory: [
        reference({ direct: false }),
        reference({ projectPath: "/outside.csproj" }),
      ],
    });
    expect(evaluateUpgrades(value).candidates).toEqual([]);
  });

  it("blocks shared declarations that affect projects outside the selection", () => {
    const value = input({
      inventory: [
        reference({
          declarationPath: "/Directory.Packages.props",
          affectedProjectPaths: ["/a.csproj", "/outside.csproj"],
        }),
      ],
    });
    expect(evaluateUpgrades(value).blocked[0]?.reason).toBe("shared-scope");
    expect(evaluateUpgrades(value).candidates).toEqual([]);
  });

  it("checks installed versions in every project sharing a declaration", () => {
    const value = input({
      inventory: [
        reference({
          declarationPath: "/Directory.Packages.props",
          affectedProjectPaths: ["/a.csproj", "/b.csproj"],
        }),
        reference({
          referenceId: "b",
          projectPath: "/b.csproj",
          declarationPath: "/Directory.Packages.props",
          affectedProjectPaths: ["/a.csproj", "/b.csproj"],
          resolvedVersion: "2.0",
        }),
      ],
    });
    expect(evaluateUpgrades(value).candidates).toEqual([]);
  });

  it("does not accept compatibility as proof of an unknown declaration scope", () => {
    const value = input({
      inventory: [
        reference({ declarationPath: null, affectedProjectPaths: [] }),
      ],
    });
    const result = evaluateUpgrades(withEvidence(value, compatible));
    expect(result.candidates[0]?.compatibility).toMatchObject({
      status: "unverified",
      reason: "reference-scope-unknown",
    });
    expect(executableCandidates(result)).toEqual([]);
  });

  it("keeps partial candidates visible but never executable", () => {
    const value = input();
    const partial = {
      ...value,
      catalogs: value.catalogs.map((c) => ({ ...c, complete: false })),
    };
    const result = evaluateUpgrades(withEvidence(partial, compatible));
    expect(result.candidates).toHaveLength(1);
    expect(result.blocked.some((b) => b.reason === "incomplete-catalog")).toBe(
      true,
    );
    expect(executableCandidates(result)).toEqual([]);
    expect(evaluateUpgrades(input({ catalogs: [] })).blocked[0]?.reason).toBe(
      "incomplete-catalog",
    );
  });

  it("tries an older eligible version only after conclusive incompatibility", () => {
    const base = input();
    const value = {
      ...base,
      inventory: [reference()],
      catalogs: [
        {
          ...base.catalogs[0]!,
          versions: [
            { version: "2.0", feedUrls: [source], listed: true },
            { version: "1.5", feedUrls: [source], listed: true },
          ],
        },
      ],
    };
    const rejected = withEvidence(value, {
      status: "incompatible",
      diagnostics: ["NU1202"],
    });
    const lower = evaluateUpgrades(rejected).candidates[0]!;
    expect(lower.version).toBe("1.5.0");
    const evidence = new Map(rejected.evidence);
    evidence.set(lower.key, { contextRevision: "r1", result: compatible });
    expect(
      executableCandidates(evaluateUpgrades({ ...value, evidence }))[0]
        ?.version,
    ).toBe("1.5.0");
    expect(
      evaluateUpgrades(
        withEvidence(value, {
          status: "unverified",
          reason: "network",
          diagnostics: [],
        }),
      ).candidates[0]?.version,
    ).toBe("2.0.0");
  });

  it("uses deterministic keys and does not mutate the inputs", () => {
    const value = input();
    const before = structuredClone(value);
    const result = evaluateUpgrades(value);
    expect(
      evaluateUpgrades({
        ...value,
        inventory: [...value.inventory].reverse(),
        catalogs: [...value.catalogs].reverse(),
      }),
    ).toEqual(result);
    expect(value).toEqual(before);
    expect(
      candidateKey({
        packageId: "DEMO",
        projectPath: "/a.csproj",
        referenceIds: ["b", "a"],
        version: "1.5+build",
        feedUrls: [source, source],
      }),
    ).toBe(
      candidateKey({
        packageId: "demo",
        projectPath: "/a.csproj",
        referenceIds: ["a", "b"],
        version: "1.5.0",
        feedUrls: [source],
      }),
    );
  });
});
