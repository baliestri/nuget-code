import type { LogEntry, LogLevel } from "@nuget-code/protocol";
import { describe, expect, it } from "vitest";
import { formatEntry, LogChannel, shouldLog } from "./logChannel";

function entry(level: LogLevel, message = "message"): LogEntry {
  return { level, time: new Date(2026, 10, 14, 9, 5, 7, 42).toISOString(), context: "NUGET", message };
}

function channel(minimum: LogLevel): { lines: string[]; log: LogChannel } {
  const lines: string[] = [];
  const log = new LogChannel(
    { appendLine: (line) => lines.push(line), show: () => {} },
    minimum,
    () => new Date(2026, 10, 14, 9, 5, 7, 42)
  );
  return { lines, log };
}

describe("shouldLog", () => {
  it.each([
    ["debug", "debug", true],
    ["verbose", "debug", true],
    ["debug", "verbose", false],
    ["verbose", "info", false],
    ["info", "info", true],
    ["warning", "info", true],
    ["info", "warning", false],
    ["error", "error", true],
    ["warning", "error", false]
  ] as const)("%s with minimum %s is %s", (level, minimum, expected) => {
    expect(shouldLog(level, minimum)).toBe(expected);
  });
});

describe("formatEntry", () => {
  it("shows the local time, the level and the context before the message", () => {
    expect(formatEntry(entry("warning", "Restored App.csproj"))).toBe(
      "09:05:07.042 [warning] [NUGET] Restored App.csproj"
    );
  });

  it("keeps a time it cannot read", () => {
    expect(formatEntry({ level: "info", time: "soon", context: "VSCODE", message: "m" })).toBe(
      "soon [info] [VSCODE] m"
    );
  });
});

describe("LogChannel", () => {
  it("drops entries below the minimum level", () => {
    const { lines, log } = channel("warning");

    log.write(entry("info"));
    log.write(entry("warning"));
    log.write(entry("error"));

    expect(lines).toHaveLength(2);
  });

  it("the minimum can change while it runs", () => {
    const { lines, log } = channel("error");
    log.write(entry("debug"));

    log.minimum = "debug";
    log.write(entry("debug"));

    expect(lines).toHaveLength(1);
  });

  it("host lines carry the HOST context and lose their trailing line break", () => {
    const { lines, log } = channel("info");

    log.host("error", "Unhandled exception.\r\n");

    expect(lines).toEqual(["09:05:07.042 [error] [HOST] Unhandled exception."]);
  });

  it("an empty host line is not written", () => {
    const { lines, log } = channel("info");

    log.host("error", "\n");

    expect(lines).toEqual([]);
  });
});
