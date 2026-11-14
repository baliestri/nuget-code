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

/** The size a folder had when it was last measured. */
export interface MeasuredSize {
  exists: boolean;
  bytes: number;
  /** When it was measured, in milliseconds since the epoch. */
  at: number;
}

/** A measured size is shown for this long; after it the folder counts as not measured. */
export const SIZE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * What the view keeps across reloads of the page: what the user chose, and the folder sizes they asked for,
 * which are slow to measure. Nothing else that comes from the backend is kept.
 */
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
  /** The measured sizes of the NuGet folders, by path. */
  folderSizes: Readonly<Record<string, MeasuredSize>>;
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
  folderSizes: {},
  log: { time: true, context: true, level: true, wrap: false, levels: Object.values(LogLevels) }
};

export type PreferencesAction =
  | { type: "set"; patch: Partial<Omit<Preferences, "log">> }
  | { type: "setLog"; patch: Partial<LogPreferences> };

export function preferencesReducer(state: Preferences, action: PreferencesAction): Preferences {
  return action.type === "set" ? { ...state, ...action.patch } : { ...state, log: { ...state.log, ...action.patch } };
}

/**
 * Reads stored preferences. Anything missing, of another type or no longer valid falls back to its default.
 * `now` is what decides which folder sizes are too old to keep.
 */
export function loadPreferences(raw: unknown, now: number = Date.now()): Preferences {
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
    folderSizes: sizes(stored["folderSizes"], now),
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

/** The stored sizes that are well formed and still young enough to be shown. */
function sizes(value: unknown, now: number): Record<string, MeasuredSize> {
  const kept: Record<string, MeasuredSize> = {};
  for (const [path, size] of Object.entries(isRecord(value) ? value : {})) {
    if (
      isRecord(size) &&
      typeof size["exists"] === "boolean" &&
      typeof size["bytes"] === "number" &&
      typeof size["at"] === "number" &&
      now - size["at"] < SIZE_LIFETIME_MS
    ) {
      kept[path] = { exists: size["exists"], bytes: size["bytes"], at: size["at"] };
    }
  }

  return kept;
}

function levels(value: unknown): readonly LogLevel[] {
  if (!Array.isArray(value)) {
    return DEFAULT_PREFERENCES.log.levels;
  }

  const known = Object.values(LogLevels);
  return known.filter((level) => value.includes(level));
}
