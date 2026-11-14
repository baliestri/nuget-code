import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, loadPreferences, preferencesReducer, SIZE_LIFETIME_MS } from "./preferences";

describe("loadPreferences", () => {
  it.each([undefined, null, "text", 5, []])("defaults apply to %j", (raw) => {
    expect(loadPreferences(raw)).toEqual(DEFAULT_PREFERENCES);
  });

  it("reads back what was stored", () => {
    const stored = {
      tab: "log",
      target: "/work/App/App.csproj",
      feed: "nuget.org",
      prerelease: true,
      packagesView: "discover",
      sort: "alphabetical",
      detailsPosition: "bottom",
      folderSizes: { "/home/me/.nuget/packages": { exists: true, bytes: 1024, at: 1_700_000_000_000 } },
      log: { time: false, context: false, level: false, wrap: true, levels: ["error", "warning"] }
    };

    expect(loadPreferences(stored, 1_700_000_000_001)).toEqual({
      ...stored,
      log: { ...stored.log, levels: ["warning", "error"] }
    });
  });

  it("drops values it does not recognise, one field at a time", () => {
    const loaded = loadPreferences({
      tab: "settings",
      target: 5,
      feed: "",
      prerelease: "yes",
      packagesView: "browse",
      sort: "random",
      detailsPosition: "left",
      folderSizes: { "/a": { exists: true, bytes: "many", at: 1 }, "/b": 5, "/c": { exists: true } },
      log: { time: "no", levels: ["error", "loud"] }
    });

    expect(loaded).toEqual({
      ...DEFAULT_PREFERENCES,
      log: { ...DEFAULT_PREFERENCES.log, levels: ["error"] }
    });
  });

  it("keeps the fields that are valid next to ones that are not", () => {
    expect(loadPreferences({ tab: "sources", sort: "random" })).toEqual({ ...DEFAULT_PREFERENCES, tab: "sources" });
  });
});

describe("stored folder sizes", () => {
  const at = 1_700_000_000_000;
  const stored = { folderSizes: { "/a": { exists: true, bytes: 10, at } } };

  it("a size measured less than thirty days ago is kept", () => {
    expect(loadPreferences(stored, at + SIZE_LIFETIME_MS - 1).folderSizes).toEqual(stored.folderSizes);
  });

  it("an older one is dropped: the folder counts as not measured", () => {
    expect(loadPreferences(stored, at + SIZE_LIFETIME_MS).folderSizes).toEqual({});
  });

  it("thirty days is the lifetime", () => {
    expect(SIZE_LIFETIME_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

describe("preferencesReducer", () => {
  it.each([
    [{ tab: "folders" }],
    [{ target: "/work/App.csproj" }],
    [{ feed: "local" }],
    [{ prerelease: true }],
    [{ packagesView: "discover" }],
    [{ sort: "alphabetical" }],
    [{ detailsPosition: "bottom" }]
  ] as const)("set %j changes only that field", (patch) => {
    expect(preferencesReducer(DEFAULT_PREFERENCES, { type: "set", patch })).toEqual({
      ...DEFAULT_PREFERENCES,
      ...patch
    });
  });

  it("setLog changes only that log option", () => {
    expect(preferencesReducer(DEFAULT_PREFERENCES, { type: "setLog", patch: { wrap: true } })).toEqual({
      ...DEFAULT_PREFERENCES,
      log: { ...DEFAULT_PREFERENCES.log, wrap: true }
    });
  });
});
