import fs from "node:fs/promises";
import path from "node:path";
import { parseXml, XmlElement } from "@rgrove/parse-xml";
import { parseNuGetVersion, sameNuGetVersion } from "#manager";
import { containsPath } from "#client/project-files";

/** Probe exact known identities only; never recursively scan a user's cache. */
export async function packageInstallations(
  packageId: string,
  versions: readonly string[],
  roots: readonly string[],
  signal?: AbortSignal,
): Promise<{ version: string; path: string }[]> {
  if (
    packageId.length > 100 ||
    !/^[\p{L}\p{Mn}\p{Nd}\p{Pc}]+(?:[.-][\p{L}\p{Mn}\p{Nd}\p{Pc}]+)*(?![\s\S])/u.test(
      packageId,
    )
  )
    return [];
  const found: { version: string; path: string }[] = [];
  for (const root of [...new Set(roots)])
    for (const version of [...new Set(versions)]) {
      signal?.throwIfAborted();
      const parsed = parseNuGetVersion(version);
      if (!parsed) continue;
      try {
        const realRoot = await fs.realpath(root);
        const directory = await fs.realpath(
          path.join(
            realRoot,
            packageId.toLowerCase(),
            parsed.normalized.toLowerCase(),
          ),
        );
        if (!containsPath(realRoot, directory)) continue;
        const manifest = await fs.realpath(
          path.join(directory, `${packageId.toLowerCase()}.nuspec`),
        );
        if (
          !containsPath(directory, manifest) ||
          (await fs.stat(manifest)).size > 1024 * 1024
        )
          continue;
        const document = parseXml(await fs.readFile(manifest, "utf8")).root;
        const child = (node: XmlElement | null | undefined, name: string) =>
          node?.children.find(
            (entry): entry is XmlElement =>
              entry instanceof XmlElement &&
              entry.name.split(":").at(-1) === name,
          );
        const metadata = child(document, "metadata");
        if (
          document?.name.split(":").at(-1) !== "package" ||
          child(metadata, "id")?.text.trim().toLowerCase() !==
            packageId.toLowerCase() ||
          !sameNuGetVersion(
            child(metadata, "version")?.text.trim() ?? "",
            version,
          )
        )
          continue;
        found.push({ version, path: directory });
      } catch {
        /* Missing, inaccessible or malformed caches are not installations. */
      }
    }
  signal?.throwIfAborted();
  return found;
}
