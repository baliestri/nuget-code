import { describe, expect, it } from "vitest";
import { systemPath } from "./paths";

describe("systemPath", () => {
  it("writes the drive letter of a Windows path in upper case", () => {
    expect(systemPath("d:\\work\\App.sln", "win32")).toBe("D:\\work\\App.sln");
    expect(systemPath("c:/work", "win32")).toBe("C:/work");
  });

  it("leaves the rest of the path as it is", () => {
    expect(systemPath("D:\\Work\\app", "win32")).toBe("D:\\Work\\app");
    expect(systemPath("\\\\server\\share\\x", "win32")).toBe("\\\\server\\share\\x");
    expect(systemPath("", "win32")).toBe("");
  });

  it.each(["linux", "darwin"])("does nothing on %s", (platform) => {
    expect(systemPath("d:/odd/name", platform)).toBe("d:/odd/name");
    expect(systemPath("/home/me", platform)).toBe("/home/me");
  });
});
