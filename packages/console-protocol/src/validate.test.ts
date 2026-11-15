import { describe, expect, it } from "vitest";
import { ConsoleError, ConsoleRequestNames, isConsoleRequest, validate } from "./index";

const invalid = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ConsoleError);
    expect((error as ConsoleError).code).toBe("invalidParams");
    return (error as ConsoleError).message;
  }

  throw new Error("Nothing was refused.");
};

describe("the requests of the console", () => {
  it("only the listed names are requests", () => {
    expect(Object.keys(ConsoleRequestNames).every(isConsoleRequest)).toBe(true);
    expect(isConsoleRequest("clearFolders")).toBe(false);
    expect(isConsoleRequest("toString")).toBe(false);
    expect(isConsoleRequest(7)).toBe(false);
  });

  it("params are reduced to the fields of the request", () => {
    expect(validate("install", { id: "Alpha", version: "1.0.0", projects: ["/a.csproj"], engine: "console" })).toEqual({
      id: "Alpha",
      version: "1.0.0",
      projects: ["/a.csproj"]
    });
    expect(validate("installed", { anything: 1 })).toEqual({});
  });

  it("flags default to false and the search to the first twenty", () => {
    expect(validate("updates", undefined)).toEqual({ prerelease: false, transitive: false });
    expect(validate("search", { query: "json" })).toEqual({ query: "json", prerelease: false, skip: 0, take: 20 });
    expect(validate("restore", {})).toEqual({ force: false });
  });

  it("a text that is missing, empty, too long or not a text is refused", () => {
    expect(invalid(() => validate("details", {}))).toContain("'id'");
    expect(invalid(() => validate("details", { id: "" }))).toContain("'id'");
    expect(invalid(() => validate("details", { id: "x".repeat(2000) }))).toContain("'id'");
    expect(invalid(() => validate("remove", { id: 3, projects: ["/a.csproj"] }))).toContain("'id'");
  });

  it("a change needs projects, and a version unless it removes", () => {
    expect(invalid(() => validate("install", { id: "Alpha", version: "1.0.0", projects: [] }))).toContain("projects");
    expect(invalid(() => validate("remove", { id: "Alpha", projects: [7] }))).toContain("projects[0]");
    expect(invalid(() => validate("update", { changes: [] }))).toContain("changes");
    expect(
      invalid(() => validate("update", { changes: [{ kind: "update", id: "Alpha", projects: ["/a"] }] }))
    ).toContain("version");
    expect(invalid(() => validate("plan", { changes: [{ kind: "purge", id: "Alpha", projects: ["/a"] }] }))).toContain(
      "kind"
    );
    expect(validate("plan", { changes: [{ kind: "remove", id: "Alpha", projects: ["/a"], extra: true }] })).toEqual({
      changes: [{ kind: "remove", id: "Alpha", projects: ["/a"] }]
    });
  });

  it("a search cannot ask for more than a hundred packages, nor for a negative page", () => {
    expect(invalid(() => validate("search", { take: 101 }))).toContain("take");
    expect(invalid(() => validate("search", { skip: -1 }))).toContain("skip");
    expect(invalid(() => validate("search", { take: 1.5 }))).toContain("take");
    expect(invalid(() => validate("search", { prerelease: "yes" }))).toContain("prerelease");
  });
});
