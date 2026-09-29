import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { compareNuGetVersions, parseNuGetVersion } from "#manager";
import {
  comparisonCases,
  invalidVersions,
  normalizationCases,
} from "#manager/test/nuget-version-cases";
import {
  checkedDotnet,
  fixtureCli,
  selectInstalledSdk,
} from "./test/dotnet-fixture";

it("matches the shared version corpus against NuGet.Versioning 6.12.1", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nuget-oracle-"));
  try {
    const cli = fixtureCli(root);
    const major = Number(process.env.SDK_MAJOR);
    const sdkVersion = await selectInstalledSdk(cli, root, major);
    await fs.writeFile(
      path.join(root, "global.json"),
      JSON.stringify({ sdk: { version: sdkVersion, rollForward: "disable" } }),
    );
    await fs.cp(
      fileURLToPath(
        new URL("./test/fixtures/version-oracle/", import.meta.url),
      ),
      root,
      { recursive: true },
    );
    await fs.writeFile(
      path.join(root, "NuGet.Config"),
      `<configuration><packageSources><clear/><add key="nuget.org" value="https://api.nuget.org/v3/index.json"/></packageSources></configuration>`,
    );
    const tfm = `net${major}.0`;
    const projectPath = path.join(root, "VersionOracle.csproj");
    const project = await fs.readFile(projectPath, "utf8");
    await fs.writeFile(
      projectPath,
      project.replace(
        "<TargetFramework>net8.0</TargetFramework>",
        `<TargetFramework>${tfm}</TargetFramework>`,
      ),
    );
    await checkedDotnet(
      cli,
      [
        "build",
        projectPath,
        "--configuration",
        "Release",
        "--verbosity",
        "quiet",
      ],
      root,
    );
    const versions = [
      ...new Set([
        ...normalizationCases.map(([input]) => input),
        ...invalidVersions,
        ...comparisonCases.flatMap(([a, b]) => [a, b]),
      ]),
    ];
    const valid = versions.filter((version) => parseNuGetVersion(version));
    const pairs = valid.flatMap((a) => valid.map((b) => [a, b]));
    const input = path.join(root, "input.json");
    await fs.writeFile(
      input,
      JSON.stringify({ Versions: versions, Pairs: pairs }),
    );
    const result = await checkedDotnet(
      cli,
      [path.join(root, "bin", "Release", tfm, "VersionOracle.dll"), input],
      root,
    );
    const oracle = JSON.parse(result.stdout) as {
      parsed: { value: string; valid: boolean; normalized: string | null }[];
      comparisons: { a: string; b: string; sign: number }[];
    };
    expect(oracle.parsed).toHaveLength(versions.length);
    for (const entry of oracle.parsed) {
      expect(
        parseNuGetVersion(entry.value)?.normalized ?? null,
        entry.value,
      ).toBe(entry.normalized);
    }
    expect(oracle.comparisons).toHaveLength(pairs.length);
    for (const entry of oracle.comparisons) {
      expect(
        Math.sign(compareNuGetVersions(entry.a, entry.b)),
        `${entry.a} vs ${entry.b}`,
      ).toBe(entry.sign);
    }
    for (const [a, b, sign] of comparisonCases) {
      expect(
        oracle.comparisons.find((item) => item.a === a && item.b === b)?.sign,
      ).toBe(sign);
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5 });
  }
});
