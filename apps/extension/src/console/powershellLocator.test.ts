import { describe, expect, it } from "vitest";
import {
  installCommand,
  locatePowerShell,
  moduleVersion,
  powerShellCandidates,
  powerShellNotice,
  versionNumbers,
  type LocatePowerShellInput
} from "./powershellLocator";

/** A machine with the given executables, each answering `--version` with the text beside it. */
function machine(files: Record<string, string | undefined>, overrides: Partial<LocatePowerShellInput> = {}) {
  const asked: string[] = [];
  const input: LocatePowerShellInput = {
    configured: "",
    path: "/usr/local/bin:/usr/bin",
    home: "/home/dev",
    platform: "linux",
    minimum: "7.6.0",
    exists: (path) => path in files,
    versionOf: (path) => {
      asked.push(path);
      return Promise.resolve(files[path]);
    },
    ...overrides
  };
  return { input, asked };
}

describe("finding PowerShell", () => {
  it("the setting wins over the PATH", async () => {
    const { input, asked } = machine(
      { "/opt/pwsh/pwsh": "PowerShell 7.7.0", "/usr/bin/pwsh": "PowerShell 7.6.0" },
      { configured: "/opt/pwsh/pwsh" }
    );

    expect(await locatePowerShell(input)).toEqual({
      kind: "found",
      path: "/opt/pwsh/pwsh",
      version: "PowerShell 7.7.0"
    });
    expect(asked).toEqual(["/opt/pwsh/pwsh"]);
  });

  it("a setting that points to nothing is an error, not a reason to keep looking", async () => {
    const { input, asked } = machine({ "/usr/bin/pwsh": "PowerShell 7.6.0" }, { configured: "/opt/gone/pwsh" });

    expect(await locatePowerShell(input)).toEqual({ kind: "badSetting", path: "/opt/gone/pwsh" });
    expect(asked).toEqual([]);
  });

  it("a setting that points to what does not run as PowerShell is an error too", async () => {
    const { input } = machine({ "/opt/notes.txt": undefined, "/opt/tool": "tool 1" }, { configured: "/opt/notes.txt" });

    expect(await locatePowerShell(input)).toEqual({ kind: "badSetting", path: "/opt/notes.txt" });
    expect(await locatePowerShell({ ...input, configured: "/opt/tool" })).toEqual({
      kind: "badSetting",
      path: "/opt/tool"
    });
  });

  it("a PowerShell of the setting that is too old is said, with its version", async () => {
    const { input } = machine({ "/opt/pwsh/pwsh": "PowerShell 7.4.6" }, { configured: "/opt/pwsh/pwsh" });

    expect(await locatePowerShell(input)).toEqual({
      kind: "tooOld",
      path: "/opt/pwsh/pwsh",
      version: "PowerShell 7.4.6"
    });
  });

  it("pwsh is looked for in the PATH, in its order", async () => {
    const { input } = machine({ "/usr/bin/pwsh": "PowerShell 7.6.2", "/usr/local/bin/pwsh": "PowerShell 7.7.0" });

    expect(await locatePowerShell(input)).toMatchObject({ kind: "found", path: "/usr/local/bin/pwsh" });
  });

  it("on Windows the executable is pwsh.exe and the PATH is split by semicolons", () => {
    expect(
      powerShellCandidates({
        path: 'C:\\Program Files\\PowerShell\\7;"C:\\Tools";;C:\\Program Files\\PowerShell\\7',
        home: "C:\\Users\\dev",
        platform: "win32"
      })
    ).toEqual([
      "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
      "C:\\Tools\\pwsh.exe",
      "C:\\Users\\dev\\.dotnet\\tools\\pwsh.exe"
    ]);
  });

  it("the .NET tools folder is looked at last", async () => {
    const tool = "/home/dev/.dotnet/tools/pwsh";
    const { input, asked } = machine({ [tool]: "PowerShell 7.6.0" });

    expect(await locatePowerShell(input)).toEqual({ kind: "found", path: tool, version: "PowerShell 7.6.0" });
    expect(asked).toEqual([tool]);
    expect(powerShellCandidates(input).at(-1)).toBe(tool);
  });

  it("nothing found is missing", async () => {
    const { input } = machine({});

    expect(await locatePowerShell(input)).toEqual({ kind: "missing" });
  });

  it("a version before the minimum is too old, unless a newer one comes later", async () => {
    const tool = "/home/dev/.dotnet/tools/pwsh";
    const old = machine({ "/usr/bin/pwsh": "PowerShell 7.5.4" });
    const both = machine({ "/usr/bin/pwsh": "PowerShell 7.5.4", [tool]: "PowerShell 7.6.0" });

    expect(await locatePowerShell(old.input)).toEqual({
      kind: "tooOld",
      path: "/usr/bin/pwsh",
      version: "PowerShell 7.5.4"
    });
    expect(await locatePowerShell(both.input)).toMatchObject({ kind: "found", path: tool });
  });

  it("a newer version is accepted, and so is a preview of one", async () => {
    const newer = machine({ "/usr/bin/pwsh": "PowerShell 7.7.0" });
    const preview = machine({ "/usr/bin/pwsh": "PowerShell 8.0.0-preview.2" });

    expect(await locatePowerShell(newer.input)).toMatchObject({ kind: "found" });
    expect(await locatePowerShell(preview.input)).toMatchObject({ kind: "found" });
  });

  it("an executable that does not answer with a version is passed over", async () => {
    const { input } = machine({ "/usr/local/bin/pwsh": undefined, "/usr/bin/pwsh": "PowerShell 7.6.1" });

    expect(await locatePowerShell(input)).toMatchObject({ kind: "found", path: "/usr/bin/pwsh" });
  });

  it("versions are read from what --version prints", () => {
    expect(versionNumbers("PowerShell 7.6.0")).toEqual([7, 6, 0]);
    expect(versionNumbers("PowerShell 7.7.0-preview.1")).toEqual([7, 7, 0]);
    expect(versionNumbers("7.10")).toEqual([7, 10, 0]);
    expect(versionNumbers("not a version")).toBeUndefined();
    expect(versionNumbers(undefined)).toBeUndefined();
  });
});

describe("installing PowerShell", () => {
  it("the install command pins the version of the module", () => {
    expect(installCommand("/usr/share/dotnet/dotnet", "7.6.0")).toEqual({
      command: "/usr/share/dotnet/dotnet",
      args: ["tool", "install", "--global", "PowerShell", "--version", "7.6.0"]
    });
  });

  it("when none was found, Install is offered and the command is shown", () => {
    expect(powerShellNotice({ kind: "missing" }, "7.6.0", "/usr/bin/dotnet")).toEqual({
      message:
        "The Package Manager Console needs PowerShell 7.6.0 or newer, and none was found. " +
        "Install runs: dotnet tool install --global PowerShell --version 7.6.0",
      actions: ["Install", "How to Install", "Open Settings"]
    });
  });

  it("one that is too old is named with its version", () => {
    const notice = powerShellNotice(
      { kind: "tooOld", path: "/usr/bin/pwsh", version: "PowerShell 7.4.6" },
      "7.6.0",
      "/usr/bin/dotnet"
    );

    expect(notice.message).toContain("/usr/bin/pwsh is PowerShell 7.4.6.");
    expect(notice.actions).toContain("Install");
  });

  it("Install is not offered without an SDK", () => {
    expect(powerShellNotice({ kind: "missing" }, "7.6.0", undefined)).toEqual({
      message: "The Package Manager Console needs PowerShell 7.6.0 or newer, and none was found.",
      actions: ["How to Install", "Open Settings"]
    });
  });

  it("a bad setting names the setting and offers to open it, and nothing else", () => {
    expect(powerShellNotice({ kind: "badSetting", path: "/opt/gone/pwsh" }, "7.6.0", "/usr/bin/dotnet")).toEqual({
      message: "The PowerShell set in nuget.console.powershellPath was not found or does not run: /opt/gone/pwsh",
      actions: ["Open Settings"]
    });
  });

  it("the version of the module is read from the file written beside it", () => {
    expect(moduleVersion('{"powershell":"7.6.0"}')).toBe("7.6.0");
    expect(moduleVersion('{"powershell":"latest"}')).toBeUndefined();
    expect(moduleVersion("{}")).toBeUndefined();
    expect(moduleVersion("not json")).toBeUndefined();
  });
});
