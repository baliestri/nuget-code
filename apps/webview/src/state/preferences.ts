import { LogLevels, type LogLevel } from "@nuget-code/protocol";

export const TABS = ["packages", "sources", "folders", "log"] as const;
export type TabId = (typeof TABS)[number];

export interface LogPreferences {
  time: boolean;
  context: boolean;
  level: boolean;
  wrap: boolean;
  /** The levels that are shown. */
  levels: readonly LogLevel[];
}

/** What the user chose in the view. Kept across reloads of the page; never data from the backend. */
export interface Preferences {
  tab: TabId;
  /** The project the package lists are about; `null` is the whole solution. */
  target: string | null;
  /** The feed searched and compared against; `null` is every enabled feed. */
  feed: string | null;
  prerelease: boolean;
  packagesView: "installed" | "discover";
  sort: "smart" | "alphabetical";
  detailsPosition: "side" | "bottom";
  log: LogPreferences;
}

export const DEFAULT_PREFERENCES: Preferences = {
  tab: "packages",
  target: null,
  feed: null,
  prerelease: false,
  packagesView: "installed",
  sort: "smart",
  detailsPosition: "side",
  log: { time: true, context: true, level: true, wrap: false, levels: Object.values(LogLevels) }
};

export type PreferencesAction =
  | { type: "set"; patch: Partial<Omit<Preferences, "log">> }
  | { type: "setLog"; patch: Partial<LogPreferences> };

export function preferencesReducer(state: Preferences, action: PreferencesAction): Preferences {
  return action.type === "set" ? { ...state, ...action.patch } : { ...state, log: { ...state.log, ...action.patch } };
}

/** Reads stored preferences. Anything missing, of another type or no longer valid falls back to its default. */
export function loadPreferences(raw: unknown): Preferences {
  const stored = isRecord(raw) ? raw : {};
  const log = isRecord(stored["log"]) ? stored["log"] : {};
  const defaults = DEFAULT_PREFERENCES;
  return {
    tab: oneOf(stored["tab"], TABS, defaults.tab),
    target: nullableText(stored["target"]),
    feed: nullableText(stored["feed"]),
    prerelease: flag(stored["prerelease"], defaults.prerelease),
    packagesView: oneOf(stored["packagesView"], ["installed", "discover"] as const, defaults.packagesView),
    sort: oneOf(stored["sort"], ["smart", "alphabetical"] as const, defaults.sort),
    detailsPosition: oneOf(stored["detailsPosition"], ["side", "bottom"] as const, defaults.detailsPosition),
    log: {
      time: flag(log["time"], defaults.log.time),
      context: flag(log["context"], defaults.log.context),
      level: flag(log["level"], defaults.log.level),
      wrap: flag(log["wrap"], defaults.log.wrap),
      levels: levels(log["levels"])
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function levels(value: unknown): readonly LogLevel[] {
  if (!Array.isArray(value)) {
    return DEFAULT_PREFERENCES.log.levels;
  }

  const known = Object.values(LogLevels);
  return known.filter((level) => value.includes(level));
}
