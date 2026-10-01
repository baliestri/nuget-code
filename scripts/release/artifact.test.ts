import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import { expect, it } from "vitest";
import yazl from "yazl";
import { sha256, validateArtifactIdentity, verifyVsix } from "./artifact.ts";

const identity = {
  version: "2.0.0",
  sourceSha: "a".repeat(40),
  vsixName: "nuget-code-2.0.0.vsix",
  sha256: "0".repeat(64),
  runId: "123",
  runAttempt: 1,
};

it("rejects invalid identity and traversal", () => {
  expect(() =>
    validateArtifactIdentity({ ...identity, sourceSha: "main" }),
  ).toThrow();
  expect(() =>
    validateArtifactIdentity({ ...identity, vsixName: "../escape.vsix" }),
  ).toThrow();
  expect(() =>
    validateArtifactIdentity({ ...identity, sha256: "bad" }),
  ).toThrow();
});

it("verifies checksum, package version, VSIX metadata and both bundles", async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "nuget-vsix-"));
  try {
    const file = path.join(folder, identity.vsixName);
    const zip = new yazl.ZipFile();
    zip.addBuffer(
      Buffer.from(
        JSON.stringify({
          version: "2.0.0",
          publisher: "baliestri",
          name: "nuget-code",
        }),
      ),
      "extension/package.json",
    );
    zip.addBuffer(
      Buffer.from(
        '<Identity Id="nuget-code" Version="2.0.0" Publisher="baliestri" />',
      ),
      "extension.vsixmanifest",
    );
    zip.addBuffer(Buffer.from("host"), "extension/dist/extension.js");
    zip.end();
    await finished(zip.outputStream.pipe(createWriteStream(file)));
    const manifest = path.join(folder, "artifact.json");
    await fs.writeFile(
      manifest,
      JSON.stringify({ ...identity, sha256: await sha256(file) }),
    );
    await expect(verifyVsix(manifest)).rejects.toThrow("missing host, webview");
    const complete = new yazl.ZipFile();
    complete.addBuffer(
      Buffer.from(
        JSON.stringify({
          version: "2.0.0",
          publisher: "baliestri",
          name: "nuget-code",
        }),
      ),
      "extension/package.json",
    );
    complete.addBuffer(
      Buffer.from(
        '<Identity Id="nuget-code" Version="2.0.0" Publisher="baliestri" />',
      ),
      "extension.vsixmanifest",
    );
    complete.addBuffer(Buffer.from("host"), "extension/dist/extension.js");
    complete.addBuffer(Buffer.from("webview"), "extension/dist/webview.js");
    complete.addBuffer(
      Buffer.from("font"),
      "extension/dist/assets/codicon.ttf",
    );
    complete.addBuffer(Buffer.from("logo"), "extension/logo.png");
    complete.addBuffer(Buffer.from("icon"), "extension/resources/package.svg");
    complete.end();
    await finished(complete.outputStream.pipe(createWriteStream(file)));
    await fs.writeFile(
      manifest,
      JSON.stringify({ ...identity, sha256: await sha256(file) }),
    );
    await expect(verifyVsix(manifest)).resolves.toMatchObject({
      version: identity.version,
      sourceSha: identity.sourceSha,
      vsixName: identity.vsixName,
    });
    await fs.appendFile(file, "tampered");
    await expect(verifyVsix(manifest)).rejects.toThrow("checksum");
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});
