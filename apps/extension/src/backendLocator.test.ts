import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { locateBackend, targetOf, type LocateInput } from "./backendLocator";

function input(overrides: Partial<LocateInput>): LocateInput {
  return {
    extensionPath: "/ext",
    override: "",
    platform: "linux",
    arch: "x64",
    isMusl: false,
    exists: () => true,
    ...overrides
  };
}

describe("targetOf", () => {
  it.each([
    ["win32", "x64", false, "win32-x64"],
    ["win32", "arm64", false, "win32-arm64"],
    ["linux", "x64", false, "linux-x64"],
    ["linux", "arm64", false, "linux-arm64"],
    ["linux", "x64", true, "alpine-x64"],
    ["linux", "arm64", true, "alpine-arm64"],
    ["darwin", "x64", false, "darwin-x64"],
    ["darwin", "arm64", false, "darwin-arm64"]
  ])("%s %s (musl: %s) is %s", (platform, arch, isMusl, expected) => {
    expect(targetOf(platform, arch, isMusl)).toBe(expected);
  });

  it.each([
    ["freebsd", "x64"],
    ["linux", "ia32"],
    ["win32", "arm"]
  ])("%s %s has no target", (platform, arch) => {
    expect(targetOf(platform, arch, false)).toBeUndefined();
  });
});

describe("locateBackend", () => {
  it("uses the bundled binary when there is no override", () => {
    expect(locateBackend(input({ platform: "linux", arch: "arm64" }))).toEqual({
      launch: { command: join("/ext", "bin", "linux-arm64", "NuGet.VisualStudioCode"), args: [] }
    });
  });

  it("adds .exe on Windows only", () => {
    expect(locateBackend(input({ platform: "win32" }))).toEqual({
      launch: { command: join("/ext", "bin", "win32-x64", "NuGet.VisualStudioCode.exe"), args: [] }
    });
  });

  it("an override executable wins", () => {
    expect(locateBackend(input({ override: "/dev/backend" }))).toEqual({
      launch: { command: "/dev/backend", args: [] }
    });
  });

  it("an override dll is run with dotnet", () => {
    expect(locateBackend(input({ override: "/dev/Backend.DLL" }))).toEqual({
      launch: { command: "dotnet", args: ["/dev/Backend.DLL"] }
    });
  });

  it("a missing override is an error that names the path", () => {
    const result = locateBackend(input({ override: "/dev/backend", exists: () => false }));

    expect(result).toEqual({ error: expect.stringContaining("/dev/backend") });
  });

  it("a missing bundled binary is an error that names the path", () => {
    const result = locateBackend(input({ exists: () => false }));

    expect(result).toEqual({ error: expect.stringContaining(join("/ext", "bin", "linux-x64")) });
  });

  it("an unsupported platform is an error", () => {
    const result = locateBackend(input({ platform: "freebsd" }));

    expect(result).toEqual({ error: expect.stringContaining("freebsd") });
  });
});
