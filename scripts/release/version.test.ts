import { expect, it } from "vitest";
import { assertVersionIncreases, parseReleaseVersion } from "./version.ts";

it("accepts only exact stable release versions", () => {
  expect(parseReleaseVersion("2.0.0")).toBe("2.0.0");
  for (const value of [
    "02.0.0",
    "2.0.0-beta",
    " 2.0.0",
    "2.0.0 ",
    "2.0",
    "2.0.0+build",
  ])
    expect(() => parseReleaseVersion(value)).toThrow();
  expect(() => assertVersionIncreases("1.1.0", "1.1.0")).toThrow();
  expect(() => assertVersionIncreases("1.0.9", "1.1.0")).toThrow();
  expect(() => assertVersionIncreases("2.0.0", "1.1.0")).not.toThrow();
});
