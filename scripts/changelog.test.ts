import { describe, expect, it } from "vitest";
import { releaseNotes } from "./changelog";

const CHANGELOG = [
  "# NuGet Manager for VSCode Changelog",
  "",
  "## [3.0.0](https://github.com/o/r/compare/v2.0.0..v3.0.0) - 2026-12-01",
  "",
  "### Features",
  "",
  "- *(webview)* Show the log - ([abc1234](https://github.com/o/r/commit/abc1234))",
  "",
  "## [2.0.0](https://github.com/o/r/compare/v1.1.0..v2.0.0) - 2026-05-01",
  "",
  "### Bug Fixes",
  "",
  "- Something - ([def5678](https://github.com/o/r/commit/def5678))",
  "",
  "## [1.1.0] - 2025-01-01",
  "",
  "- First"
].join("\n");

describe("releaseNotes", () => {
  it("returns the body of the version's section, without its title", () => {
    expect(releaseNotes(CHANGELOG, "3.0.0")).toBe(
      "### Features\n\n- *(webview)* Show the log - ([abc1234](https://github.com/o/r/commit/abc1234))"
    );
  });

  it("stops at the next version", () => {
    expect(releaseNotes(CHANGELOG, "2.0.0")).not.toContain("First");
  });

  it("reads the last section to the end of the file", () => {
    expect(releaseNotes(CHANGELOG, "1.1.0")).toBe("- First");
  });

  it("a version that is a prefix of another is not taken for it", () => {
    expect(releaseNotes(CHANGELOG.replace("[3.0.0]", "[3.0.0-rc.1]"), "3.0.0")).toBeUndefined();
  });

  it("has nothing for a version without a section", () => {
    expect(releaseNotes(CHANGELOG, "9.9.9")).toBeUndefined();
  });

  it("reads a file with Windows line endings", () => {
    expect(releaseNotes(CHANGELOG.replaceAll("\n", "\r\n"), "1.1.0")).toBe("- First");
  });
});
