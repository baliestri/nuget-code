import type { LogEntry, LogLevel } from "@nuget-code/protocol";
import { describe, expect, it } from "vitest";
import { formatLine, LogBuffer, shouldFollow } from "./logBuffer";

function entry(message: string, level: LogLevel = "info"): LogEntry {
  return { level, time: "2026-11-14T16:08:13.250-03:00", context: "NUGET", message };
}

const ALL = new Set<LogLevel>(["debug", "verbose", "info", "warning", "error"]);

describe("LogBuffer", () => {
  it("keeps the newest entries up to its capacity", () => {
    const buffer = new LogBuffer(3);

    for (const message of ["one", "two", "three", "four"]) {
      buffer.push(entry(message));
    }

    expect(buffer.size).toBe(3);
    expect(buffer.entries(ALL).map((item) => item.message)).toEqual(["two", "three", "four"]);
  });

  it("entries are filtered by level, oldest first", () => {
    const buffer = new LogBuffer(10);
    buffer.push(entry("a", "debug"));
    buffer.push(entry("b", "error"));
    buffer.push(entry("c", "info"));

    expect(buffer.entries(new Set<LogLevel>(["info", "error"])).map((item) => item.message)).toEqual(["b", "c"]);
    expect(buffer.entries(new Set())).toEqual([]);
  });

  it("clear empties it", () => {
    const buffer = new LogBuffer(10);
    buffer.push(entry("a"));

    buffer.clear();

    expect(buffer.size).toBe(0);
    expect(buffer.entries(ALL)).toEqual([]);
  });
});

describe("formatLine", () => {
  it.each([
    [true, true, true, "16:08:13|NUGET|INFOR| Restored."],
    [false, true, true, "NUGET|INFOR| Restored."],
    [true, false, true, "16:08:13|INFOR| Restored."],
    [true, true, false, "16:08:13|NUGET| Restored."],
    [false, false, true, "INFOR| Restored."],
    [false, false, false, "Restored."]
  ])("time %s, context %s, level %s", (time, context, level, line) => {
    expect(formatLine(entry("Restored."), { time, context, level })).toBe(line);
  });

  it("every level has a code of five letters", () => {
    const codes = [...ALL].map((level) => formatLine(entry("x", level), { time: false, context: false, level: true }));

    expect(codes).toEqual(["DEBUG| x", "VERBO| x", "INFOR| x", "WARNI| x", "ERROR| x"]);
  });

  it("the time is the one the backend wrote, whatever the offset", () => {
    const line = formatLine(
      { ...entry("x"), time: "2026-01-02T03:04:05+09:00" },
      { time: true, context: false, level: false }
    );

    expect(line).toBe("03:04:05| x");
  });
});

describe("shouldFollow", () => {
  it("follows at the end, and within a few pixels of it", () => {
    expect(shouldFollow(900, 100, 1000)).toBe(true);
    expect(shouldFollow(895, 100, 1000)).toBe(true);
  });

  it("stops following once scrolled up", () => {
    expect(shouldFollow(500, 100, 1000)).toBe(false);
  });

  it("follows a list shorter than its window", () => {
    expect(shouldFollow(0, 400, 120)).toBe(true);
  });
});
