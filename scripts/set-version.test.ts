import { describe, expect, it } from "vitest";
import { setVersion } from "./set-version";

const PACKAGE = '{\n  "name": "nuget-code",\n  "version": "3.0.0-alpha.0",\n  "private": true\n}\n';

describe("setVersion", () => {
  it("replaces the version and nothing else", () => {
    expect(setVersion(PACKAGE, "3.0.0")).toBe(PACKAGE.replace("3.0.0-alpha.0", "3.0.0"));
  });

  it("keeps Windows line endings", () => {
    const text = PACKAGE.replaceAll("\n", "\r\n");

    expect(setVersion(text, "3.1.0")).toBe(text.replace("3.0.0-alpha.0", "3.1.0"));
  });

  it("does not touch a version field of a nested object", () => {
    const text = '{\n  "engines": { "version": "1" },\n  "version": "1.0.0"\n}\n';

    expect(setVersion(text, "2.0.0")).toBe('{\n  "engines": { "version": "1" },\n  "version": "2.0.0"\n}\n');
  });

  it.each(["v3.0.0", "3.0", "3.0.0-alpha.1", "3.0.0.1", ""])("refuses %j", (version) => {
    expect(() => setVersion(PACKAGE, version)).toThrow(/major\.minor\.patch/);
  });

  it("fails when there is no version field", () => {
    expect(() => setVersion('{\n  "name": "x"\n}\n', "1.0.0")).toThrow(/no version/);
  });
});
