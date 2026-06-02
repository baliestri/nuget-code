import type { LogLevel } from "#contracts";

export const logLevels = [
  "debug",
  "verbose",
  "information",
  "minimal",
  "warning",
  "error",
] as const satisfies readonly LogLevel[];

export function splitAuthors(authors: string | undefined): string[] {
  return (
    authors
      ?.split(/[,;]/)
      .map((author) => author.trim())
      .filter(Boolean) ?? []
  );
}

export function rowClass(selected: boolean, extra: string): string {
  return `${extra} ${
    selected
      ? "bg-list-active text-list-active-fg"
      : "text-fg hover:bg-list-hover hover:text-list-hover-fg"
  }`;
}

export function logLevelClass(level: LogLevel): string {
  switch (level) {
    case "error":
      return "text-error";
    case "warning":
      return "text-warning";
    case "debug":
    case "verbose":
      return "text-fg-muted";
    default:
      return "text-info";
  }
}
