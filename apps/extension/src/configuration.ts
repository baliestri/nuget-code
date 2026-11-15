import {
  LogLevels,
  RestoreEngines,
  type ConfigurationParams,
  type InitializeParams,
  type LogLevel,
  type RestoreEngine
} from "@nuget-code/protocol";

/** The extension's settings, with defaults applied. Keys are relative to the `nuget` section. */
export interface Settings {
  dotnetPath: string;
  restoreEngine: RestoreEngine;
  restoreOnOpen: boolean;
  feedTimeoutSeconds: number;
  logLevel: LogLevel;
  backendPath: string;
  /** Whether packages are checked for known vulnerabilities. */
  audit: boolean;
  /** Whether the Package Manager Console can be opened. */
  consoleEnabled: boolean;
  /** The PowerShell the console runs in; empty to look for one. */
  powershellPath: string;
}

export const SECTION = "nuget";

export const DEFAULTS: Settings = {
  dotnetPath: "",
  restoreEngine: RestoreEngines.embedded,
  restoreOnOpen: true,
  feedTimeoutSeconds: 30,
  logLevel: LogLevels.info,
  backendPath: "",
  audit: true,
  consoleEnabled: true,
  powershellPath: ""
};

/** Reads the settings through `get`, which looks a key up in the `nuget` section. An invalid value is replaced by its default. */
export function readSettings(get: (key: string) => unknown): Settings {
  return {
    dotnetPath: text(get("dotnetPath"), DEFAULTS.dotnetPath),
    restoreEngine: oneOf(get("restore.engine"), Object.values(RestoreEngines), DEFAULTS.restoreEngine),
    restoreOnOpen: flag(get("restore.onOpen"), DEFAULTS.restoreOnOpen),
    feedTimeoutSeconds: positive(get("feedTimeoutSeconds"), DEFAULTS.feedTimeoutSeconds),
    logLevel: oneOf(get("log.level"), Object.values(LogLevels), DEFAULTS.logLevel),
    backendPath: text(get("backend.path"), DEFAULTS.backendPath),
    audit: flag(get("audit.enabled"), DEFAULTS.audit),
    consoleEnabled: flag(get("console.enabled"), DEFAULTS.consoleEnabled),
    powershellPath: text(get("console.powershellPath"), DEFAULTS.powershellPath)
  };
}

export function toInitializeParams(settings: Settings): InitializeParams {
  return {
    ...(settings.dotnetPath === "" ? {} : { dotnetPath: settings.dotnetPath }),
    feedTimeoutSeconds: settings.feedTimeoutSeconds,
    restoreEngine: settings.restoreEngine,
    restoreOnOpen: settings.restoreOnOpen,
    audit: settings.audit
  };
}

export function toConfigurationParams(settings: Settings): ConfigurationParams {
  return { restoreEngine: settings.restoreEngine, restoreOnOpen: settings.restoreOnOpen, audit: settings.audit };
}

/** The backend reads these only when it starts. */
export function requiresRestart(before: Settings, after: Settings): boolean {
  return (
    before.dotnetPath !== after.dotnetPath ||
    before.feedTimeoutSeconds !== after.feedTimeoutSeconds ||
    before.backendPath !== after.backendPath
  );
}

/** Whether the backend has to be told, short of a restart. */
export function requiresNotification(before: Settings, after: Settings): boolean {
  return (
    before.restoreEngine !== after.restoreEngine ||
    before.restoreOnOpen !== after.restoreOnOpen ||
    before.audit !== after.audit
  );
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}
