/*
 * Writes the version of the extension:
 *
 *   tsx scripts/set-version.ts <major.minor.patch>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// A top-level field of the file as the formatter writes it: two spaces, at the start of a line.
const FIELD = /^( {2}"version": ")[^"]*(")/m;

/** The text of a package.json with its version replaced, and nothing else changed. */
export function setVersion(packageJson: string, version: string): string {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`The version must be major.minor.patch, and '${version}' is not.`);
  }

  if (!FIELD.test(packageJson)) {
    throw new Error("The file has no version field.");
  }

  return packageJson.replace(FIELD, `$1${version}$2`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = fileURLToPath(new URL("../apps/extension/package.json", import.meta.url));
  try {
    writeFileSync(file, setVersion(readFileSync(file, "utf8"), process.argv[2] ?? ""));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
