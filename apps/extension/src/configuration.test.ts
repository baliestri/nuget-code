import { describe, expect, it } from "vitest";
import {
  DEFAULTS,
  readSettings,
  requiresNotification,
  requiresRestart,
  toConfigurationParams,
  toInitializeParams,
  type Settings
} from "./configuration";

function settingsFrom(values: Record<string, unknown>): Settings {
  return readSettings((key) => values[key]);
}

describe("readSettings", () => {
  it("applies the defaults when nothing is set", () => {
    expect(settingsFrom({})).toEqual(DEFAULTS);
  });

  it("reads every key", () => {
    expect(
      settingsFrom({
        dotnetPath: " /opt/dotnet/dotnet ",
        "restore.engine": "console",
        "restore.onOpen": false,
        feedTimeoutSeconds: 12.9,
        "log.level": "debug",
        "backend.path": "/dev/backend.dll",
        "audit.enabled": false,
        "console.enabled": false,
        "console.powershellPath": " /opt/pwsh/pwsh "
      })
    ).toEqual({
      dotnetPath: "/opt/dotnet/dotnet",
      restoreEngine: "console",
      restoreOnOpen: false,
      feedTimeoutSeconds: 12,
      logLevel: "debug",
      backendPath: "/dev/backend.dll",
      audit: false,
      consoleEnabled: false,
      powershellPath: "/opt/pwsh/pwsh"
    });
  });

  it.each([
    ["restore.engine", "nope", "restoreEngine"],
    ["restore.engine", 3, "restoreEngine"],
    ["restore.onOpen", "yes", "restoreOnOpen"],
    ["audit.enabled", "no", "audit"],
    ["console.enabled", "no", "consoleEnabled"],
    ["console.powershellPath", 7, "powershellPath"],
    ["feedTimeoutSeconds", -1, "feedTimeoutSeconds"],
    ["feedTimeoutSeconds", 0, "feedTimeoutSeconds"],
    ["feedTimeoutSeconds", "30", "feedTimeoutSeconds"],
    ["log.level", "loud", "logLevel"],
    ["dotnetPath", 5, "dotnetPath"]
  ] as const)("an invalid %s (%j) falls back to the default", (key, value, field) => {
    expect(settingsFrom({ [key]: value })[field]).toBe(DEFAULTS[field]);
  });
});

describe("backend parameters", () => {
  it("initialize params omit an empty dotnet path", () => {
    expect(toInitializeParams(DEFAULTS)).toEqual({
      feedTimeoutSeconds: 30,
      restoreEngine: "embedded",
      restoreOnOpen: true,
      audit: true
    });
  });

  it("initialize params carry a dotnet path that is set", () => {
    expect(toInitializeParams({ ...DEFAULTS, dotnetPath: "/opt/dotnet" }).dotnetPath).toBe("/opt/dotnet");
  });

  it("configuration params carry the settings that change without a restart", () => {
    expect(
      toConfigurationParams({ ...DEFAULTS, restoreEngine: "msbuild", restoreOnOpen: false, audit: false })
    ).toEqual({
      restoreEngine: "msbuild",
      restoreOnOpen: false,
      audit: false
    });
  });
});

describe("what a change requires", () => {
  it.each([
    [{ dotnetPath: "/x" }, true, false],
    [{ feedTimeoutSeconds: 5 }, true, false],
    [{ backendPath: "/x" }, true, false],
    [{ restoreEngine: "console" }, false, true],
    [{ restoreOnOpen: false }, false, true],
    [{ audit: false }, false, true],
    [{ logLevel: "debug" }, false, false],
    // The console is the extension's own: the backend is not told about it.
    [{ consoleEnabled: false }, false, false],
    [{ powershellPath: "/opt/pwsh/pwsh" }, false, false],
    [{}, false, false]
  ] as const)("%j: restart %s, notification %s", (change, restart, notification) => {
    const after = { ...DEFAULTS, ...change } as Settings;

    expect(requiresRestart(DEFAULTS, after)).toBe(restart);
    expect(requiresNotification(DEFAULTS, after)).toBe(notification);
  });
});
