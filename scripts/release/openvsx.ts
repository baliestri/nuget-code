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

async function openVsxVersionMetadata(
  version: string,
  request: typeof fetch = fetch,
): Promise<Record<string, unknown> | null> {
  const response = await request(
    `https://open-vsx.org/api/${namespace}/${extension}/universal/${encodeURIComponent(version)}`,
    { headers: { Accept: "application/json" } },
  );
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(`Open VSX version lookup failed: HTTP ${response.status}.`);
  const metadata = (await response.json()) as Record<string, unknown>;
  if (
    metadata.namespace !== namespace ||
    metadata.name !== extension ||
    metadata.version !== version
  )
    throw new Error("Open VSX version identity differs from the release.");
  return metadata;
}

export async function openVsxHasVersion(
  version: string,
  request: typeof fetch = fetch,
): Promise<boolean> {
  return (await openVsxVersionMetadata(version, request)) !== null;
}

export async function openVsxPublishedChecksum(
  version: string,
  request: typeof fetch = fetch,
): Promise<string | null> {
  const metadata = await openVsxVersionMetadata(version, request);
  if (!metadata) return null;
  const files = metadata.files as Record<string, unknown> | undefined;
  const url = files?.sha256;
  const expectedPath = `/api/${namespace}/${extension}/${encodeURIComponent(version)}/file/${namespace}.${extension}-${encodeURIComponent(version)}.sha256`;
  if (
    typeof url !== "string" ||
    new URL(url).origin !== "https://open-vsx.org" ||
    new URL(url).pathname !== expectedPath
  )
    throw new Error("Open VSX checksum URL differs from the release.");
  const response = await request(url);
  if (!response.ok)
    throw new Error(
      `Open VSX checksum lookup failed: HTTP ${response.status}.`,
    );
  const checksum = (await response.text()).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(checksum))
    throw new Error("Open VSX checksum response is invalid.");
  return checksum;
}

export async function recoverOpenVsxReceipt(
  prepared: PreparedRelease,
  artifact: Awaited<ReturnType<typeof verifyVsix>>,
  receiptPath: string,
): Promise<PublicationReceipt | null> {
  const checksum = await openVsxPublishedChecksum(artifact.version);
  if (!checksum) return null;
  if (checksum !== artifact.sha256)
    throw new Error("Open VSX VSIX checksum differs from release artifact.");
  const receipt: PublicationReceipt = {
    version: artifact.version,
    sourceSha: artifact.sourceSha,
    sha256: artifact.sha256,
    runId: artifact.runId,
    runAttempt: artifact.runAttempt,
  };
  validateReceipt(receipt, prepared, artifact, "Open VSX");
  await fs.writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

export async function publishOpenVsx(
  repo: string,
  manifestPath: string,
  prepared: PreparedRelease,
  receiptPath: string,
): Promise<PublicationReceipt> {
  const artifact = await verifyVsix(manifestPath);
  assertArtifactMatches(prepared, artifact);
  let existing = (await fs
    .readFile(receiptPath, "utf8")
    .then(JSON.parse, () => null)) as unknown;
  if (!existing)
    existing = await recoverOpenVsxReceipt(prepared, artifact, receiptPath);
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
  for (let attempt = 0; attempt < 120; attempt++) {
    const checksum = await openVsxPublishedChecksum(artifact.version);
    if (checksum) {
      if (checksum !== artifact.sha256)
        throw new Error(
          "Open VSX VSIX checksum differs from release artifact.",
        );
      published = true;
      break;
    }
    if (attempt < 119) await delay(5000);
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
