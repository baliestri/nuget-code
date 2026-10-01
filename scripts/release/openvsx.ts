import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { verifyVsix } from "./artifact.ts";
import { assertArtifactMatches, type PreparedRelease } from "./identity.ts";
import {
  classifyOpenVsx,
  validateReceipt,
  type PublicationReceipt,
} from "./recovery.ts";
import { command } from "./publish.ts";

const namespace = "baliestri";
const extension = "nuget-code";

export async function openVsxHasVersion(
  version: string,
  request: typeof fetch = fetch,
): Promise<boolean> {
  const response = await request(
    `https://open-vsx.org/api/${namespace}/${extension}/universal/${encodeURIComponent(version)}`,
    { headers: { Accept: "application/json" } },
  );
  if (response.status === 404) return false;
  if (!response.ok)
    throw new Error(`Open VSX version lookup failed: HTTP ${response.status}.`);
  const metadata = (await response.json()) as Record<string, unknown>;
  if (
    metadata.namespace !== namespace ||
    metadata.name !== extension ||
    metadata.version !== version
  )
    throw new Error("Open VSX version identity differs from the release.");
  return true;
}

export async function publishOpenVsx(
  repo: string,
  manifestPath: string,
  prepared: PreparedRelease,
  receiptPath: string,
): Promise<PublicationReceipt> {
  const artifact = await verifyVsix(manifestPath);
  assertArtifactMatches(prepared, artifact);
  const existing = (await fs
    .readFile(receiptPath, "utf8")
    .then(JSON.parse, () => null)) as unknown;
  const state = classifyOpenVsx(
    await openVsxHasVersion(artifact.version),
    existing,
    prepared,
    artifact,
  );
  if (state === "verified")
    return validateReceipt(existing, prepared, artifact, "Open VSX");
  if (state === "ambiguous")
    throw new Error(
      "Open VSX version exists without matching receipt; publication outcome is ambiguous.",
    );

  const vsixPath = path.join(path.dirname(manifestPath), artifact.vsixName);
  const args = [
    "--dir",
    "packages/extension",
    "exec",
    "ovsx",
    "publish",
    vsixPath,
  ];
  if (!process.env.OVSX_PAT) args.push("--trusted-publishing");
  command("pnpm", args, repo);

  let published = false;
  for (let attempt = 0; attempt < 24; attempt++) {
    if (await openVsxHasVersion(artifact.version)) {
      published = true;
      break;
    }
    if (attempt < 23) await delay(5000);
  }
  if (!published)
    throw new Error("Open VSX did not confirm the published version.");

  const receipt = {
    version: artifact.version,
    sourceSha: artifact.sourceSha,
    sha256: artifact.sha256,
    runId: artifact.runId,
    runAttempt: artifact.runAttempt,
  };
  await fs.writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}
