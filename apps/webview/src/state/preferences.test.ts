import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, loadPreferences, preferencesReducer } from "./preferences";

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
      log: { time: false, context: false, level: false, wrap: true, levels: ["error", "warning"] }
    };

    expect(loadPreferences(stored)).toEqual({ ...stored, log: { ...stored.log, levels: ["warning", "error"] } });
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
