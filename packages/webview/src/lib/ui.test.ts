import { describe, expect, it } from "vitest";
import { logLevelClass, rowClass, splitAuthors } from "./ui.js";

describe("UI helpers", () => {
  it("splits author lists and builds row classes", () => {
    expect(splitAuthors(" Alice, Bob; Carol ; ")).toEqual([
      "Alice",
      "Bob",
      "Carol",
    ]);
    expect(splitAuthors(undefined)).toEqual([]);
    expect(rowClass(true, "row")).toContain("bg-list-active");
    expect(rowClass(false, "row")).toContain("hover:bg-list-hover");
  });

  it("maps log levels to CSS classes", () => {
    expect(logLevelClass("error")).toBe("text-error");
    expect(logLevelClass("warning")).toBe("text-warning");
    expect(logLevelClass("debug")).toBe("text-fg-muted");
    expect(logLevelClass("verbose")).toBe("text-fg-muted");
    expect(logLevelClass("information")).toBe("text-info");
  });
});
