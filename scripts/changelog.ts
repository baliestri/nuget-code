/*
 * Prints the release notes of a version, taken from CHANGELOG.md:
 *
 *   tsx scripts/changelog.ts <version>
 *
 * Exits with 1, printing nothing, when the changelog has no section for it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The body of the section of a version, without its title; undefined when there is no such section. */
export function releaseNotes(changelog: string, version: string): string | undefined {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
  if (start < 0) {
    return undefined;
  }

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = process.argv[2] ?? "";
  const notes = releaseNotes(readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8"), version);
  if (notes === undefined) {
    process.exit(1);
  }

  console.log(notes);
}
