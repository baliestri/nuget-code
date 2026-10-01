import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import yauzl from "yauzl";

export interface ReleaseArtifact {
  version: string;
  sourceSha: string;
  vsixName: string;
  sha256: string;
  runId: string;
  runAttempt: number;
}

const sha = /^[0-9a-f]{40}$/;
const hash = /^[0-9a-f]{64}$/;
const version = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function validateArtifactIdentity(value: unknown): ReleaseArtifact {
  if (!value || typeof value !== "object")
    throw new Error("Missing release artifact identity.");
  const item = value as Record<string, unknown>;
  if (typeof item.version !== "string" || !version.test(item.version))
    throw new Error("Invalid artifact version.");
  if (typeof item.sourceSha !== "string" || !sha.test(item.sourceSha))
    throw new Error("Invalid artifact source SHA.");
  if (
    typeof item.vsixName !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.vsix$/.test(item.vsixName) ||
    item.vsixName.includes("..") ||
    path.basename(item.vsixName) !== item.vsixName
  )
    throw new Error("Invalid VSIX name.");
  if (typeof item.sha256 !== "string" || !hash.test(item.sha256))
    throw new Error("Invalid VSIX checksum.");
  if (typeof item.runId !== "string" || !/^[1-9]\d*$/.test(item.runId))
    throw new Error("Invalid run ID.");
  if (!Number.isSafeInteger(item.runAttempt) || (item.runAttempt as number) < 1)
    throw new Error("Invalid run attempt.");
  return item as unknown as ReleaseArtifact;
}

export async function sha256(file: string): Promise<string> {
  return createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");
}

function zipEntries(file: string): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: true }, (error, zip) => {
      if (error || !zip)
        return reject(error ?? new Error("Invalid VSIX archive."));
      const entries = new Map<string, Buffer>();
      zip.on("error", reject);
      zip.on("end", () => resolve(entries));
      zip.on("entry", (entry) => {
        if (entry.fileName.endsWith("/")) return zip.readEntry();
        if (entry.fileName.includes("..") || entry.fileName.startsWith("/"))
          return reject(new Error("Unsafe VSIX path."));
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream)
            return reject(streamError ?? new Error("Unreadable VSIX entry."));
          const chunks: Buffer[] = [];
          stream.on("data", (chunk: Buffer) => chunks.push(chunk));
          stream.on("error", reject);
          stream.on("end", () => {
            entries.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}

export async function verifyVsix(
  manifestPath: string,
): Promise<ReleaseArtifact> {
  const manifest = validateArtifactIdentity(
    JSON.parse(await fs.readFile(manifestPath, "utf8")),
  );
  const file = path.join(path.dirname(manifestPath), manifest.vsixName);
  if ((await sha256(file)) !== manifest.sha256)
    throw new Error("VSIX checksum differs from release manifest.");
  const entries = await zipEntries(file);
  const extension = entries.get("extension/package.json");
  const vsixManifest = entries.get("extension.vsixmanifest");
  if (
    !extension ||
    !vsixManifest ||
    !entries.get("extension/dist/extension.js") ||
    !entries.get("extension/dist/webview.js") ||
    !entries.get("extension/dist/assets/codicon.ttf") ||
    !entries.get("extension/logo.png") ||
    !entries.get("extension/resources/package.svg")
  )
    throw new Error("VSIX is missing host, webview, assets or metadata.");
  const pkg = JSON.parse(extension.toString("utf8")) as {
    version?: string;
    publisher?: string;
    name?: string;
  };
  if (pkg.version !== manifest.version || !pkg.publisher || !pkg.name)
    throw new Error("VSIX version or extension metadata differs.");
  const xml = vsixManifest.toString("utf8");
  const identity = xml.match(/<Identity\b[^>]*>/)?.[0] ?? "";
  if (
    !identity.includes(`Id="${pkg.name}"`) ||
    !identity.includes(`Publisher="${pkg.publisher}"`) ||
    !identity.includes(`Version="${manifest.version}"`)
  )
    throw new Error("VSIX manifest identity differs.");
  for (const name of entries.keys()) {
    if (
      /^extension\/(?:src\/|test\/|tests\/|node_modules\/|docs\/superpowers\/)/i.test(
        name,
      ) ||
      /(?:^|\/)\.env(?:\.|$)/i.test(name) ||
      /(?:\.(?:test|spec)\.[cm]?js|\.(?:map|ts))$/i.test(name)
    )
      throw new Error(`Development file in VSIX: ${name}`);
  }
  return manifest;
}
