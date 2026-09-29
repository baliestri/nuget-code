import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  dotnetArguments,
  resolveDotnetSdk,
  supportsListNoRestore,
} from "./dotnet-sdk";

describe("SDK-aware arguments", () => {
  const projectPath = path.resolve("App & Tests", "App.csproj");
  it.each([8, 9])("uses legacy commands on SDK %s", (major) => {
    const sdk = {
      major,
      version: `${major}.0.100`,
      cwd: path.dirname(projectPath),
    };
    expect(
      dotnetArguments(sdk, {
        kind: "add",
        projectPath,
        packageId: "Demo",
        version: "1.5.0",
      }),
    ).toEqual(["add", projectPath, "package", "Demo", "--version", "1.5.0"]);
    expect(
      dotnetArguments(sdk, { kind: "remove", projectPath, packageId: "Demo" }),
    ).toEqual(["remove", projectPath, "package", "Demo"]);
    expect(
      dotnetArguments(sdk, { kind: "list", projectPath, outdated: false }),
    ).toEqual([
      "list",
      projectPath,
      "package",
      "--include-transitive",
      "--format",
      "json",
      "--output-version",
      "1",
    ]);
    expect(supportsListNoRestore(sdk)).toBe(false);
  });
  it.each([10, 11])("uses modern commands on SDK %s", (major) => {
    const sdk = {
      major,
      version: `${major}.0.100`,
      cwd: path.dirname(projectPath),
    };
    expect(
      dotnetArguments(sdk, {
        kind: "add",
        projectPath,
        packageId: "Demo",
        version: "1.5.0",
      }),
    ).toEqual([
      "package",
      "add",
      "Demo",
      "--project",
      projectPath,
      "--version",
      "1.5.0",
    ]);
    expect(
      dotnetArguments(sdk, { kind: "remove", projectPath, packageId: "Demo" }),
    ).toEqual(["package", "remove", "Demo", "--project", projectPath]);
    expect(
      dotnetArguments(sdk, {
        kind: "list",
        projectPath,
        outdated: true,
        noRestore: true,
      }),
    ).toEqual([
      "package",
      "list",
      "--project",
      projectPath,
      "--outdated",
      "--include-transitive",
      "--format",
      "json",
      "--output-version",
      "1",
      "--no-restore",
    ]);
    expect(supportsListNoRestore(sdk)).toBe(true);
  });
  it("rejects unsupported SDKs and unsupported list flags", () => {
    expect(() =>
      dotnetArguments(
        { major: 7, version: "7.0.100", cwd: "/" },
        { kind: "list", projectPath, outdated: false },
      ),
    ).toThrow();
    expect(() =>
      dotnetArguments(
        { major: 8, version: "8.0.100", cwd: "/" },
        { kind: "list", projectPath, outdated: false, noRestore: true },
      ),
    ).toThrow();
  });
});

describe("effective SDK resolution", () => {
  const projectPath = path.resolve("nested", "App.csproj");
  it("resolves from the project directory and does not cache across changes", async () => {
    const runDotnet = vi
      .fn()
      .mockResolvedValueOnce({ code: 0, stdout: "8.0.425\n", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "10.0.400\n", stderr: "" });
    expect(await resolveDotnetSdk({ runDotnet }, projectPath)).toMatchObject({
      major: 8,
      cwd: path.dirname(projectPath),
    });
    expect(await resolveDotnetSdk({ runDotnet }, projectPath)).toMatchObject({
      major: 10,
    });
    expect(runDotnet).toHaveBeenCalledWith(
      ["--version"],
      path.dirname(projectPath),
      { signal: undefined },
    );
  });
  it.each([
    [
      {
        code: -1,
        stdout: "",
        stderr: "launch",
        failure: { kind: "launch", code: "ENOENT" },
      },
      "missing",
    ],
    [
      {
        code: 1,
        stdout: "",
        stderr:
          "A compatible .NET SDK was not found. Requested SDK version: 99.0.100",
      },
      "pinned-unavailable",
    ],
    [{ code: 1, stdout: "", stderr: "No .NET SDKs were found." }, "missing"],
    [{ code: 0, stdout: "7.0.100", stderr: "" }, "unsupported"],
    [{ code: 0, stdout: "not a version", stderr: "" }, "invalid-output"],
    [
      { code: 1, stdout: "", stderr: "Invalid global.json content" },
      "invalid-output",
    ],
  ])("reports the resolution failure as %s / %s", async (result, code) => {
    await expect(
      resolveDotnetSdk(
        { runDotnet: vi.fn().mockResolvedValue(result) },
        projectPath,
      ),
    ).rejects.toMatchObject({ name: "SdkResolutionError", code });
  });
  it("propagates cancellation unchanged", async () => {
    const error = new DOMException("cancelled", "AbortError");
    await expect(
      resolveDotnetSdk(
        { runDotnet: vi.fn().mockRejectedValue(error) },
        projectPath,
      ),
    ).rejects.toBe(error);
  });
});
