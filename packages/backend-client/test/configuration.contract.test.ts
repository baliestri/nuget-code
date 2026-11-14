import { existsSync, readdirSync } from "node:fs";
import { ErrorCodes, SourceProperties } from "@nuget-code/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ResponseError } from "../src/index";
import { PrivateFeed } from "./support/feedServer";
import { expectShape, type Shape } from "./support/shape";
import { startBackend, type RunningBackend } from "./support/testBackend";
import { TestWorkspace } from "./support/testWorkspace";

const feed: Shape = {
  name: "string",
  source: "string",
  enabled: "boolean",
  allowInsecureConnections: "boolean",
  protocolVersion: "number",
  isLocal: "boolean",
  disableTlsCertificateValidation: "boolean",
  isMachineWide: "boolean",
  "declaredIn?": "string"
};

describe("sources, folders and credentials", () => {
  let workspace: TestWorkspace;
  let backend: RunningBackend;

  beforeEach(() => {
    workspace = new TestWorkspace();
  });

  afterEach(async () => {
    await backend.stop();
    workspace.dispose();
  });

  it("sources list, add, update, remove and setProperty round-trip", async () => {
    backend = await startBackend(workspace);
    const config = workspace.resolve("NuGet.config");

    const listed = await backend.api.listSources();
    const added = await backend.api.addSource({ name: "extra", source: "extra-feed" });
    const updated = await backend.api.updateSource({ name: "extra", newName: "renamed", enabled: false });
    const afterUpdate = await backend.api.listSources();
    await backend.api.removeSource({ name: "renamed" });
    await backend.api.setSourceProperty({
      file: config,
      property: SourceProperties.globalPackagesFolder,
      value: "elsewhere"
    });
    const afterRemove = await backend.api.listSources();

    expectShape(listed, {
      files: [
        {
          path: "string",
          feeds: [feed],
          writable: "boolean",
          isMachineWide: "boolean",
          "globalPackagesFolder?": "string",
          "repositoryPath?": "string"
        }
      ],
      effective: [feed],
      fallbackFolders: ["string"],
      globalPackagesFolder: "string",
      "localPackagesFolder?": "string"
    });
    expectShape(added, feed);
    expect(added.enabled).toBe(true);
    expect(updated.name).toBe("renamed");
    expect(updated.enabled).toBe(false);
    expect(afterUpdate.effective.map((item) => item.name)).toEqual(["local", "renamed"]);
    expect(afterRemove.effective.map((item) => item.name)).toEqual(["local"]);
    expect(afterRemove.files[0]?.globalPackagesFolder).toBe("elsewhere");
  });

  it("a duplicate source is error 1108", async () => {
    backend = await startBackend(workspace);

    const error = await backend.api.addSource({ name: "local", source: "other" }).catch((reason: unknown) => reason);

    expect((error as ResponseError<unknown>).code).toBe(ErrorCodes.feedDuplicate);
  });

  it("folders list marks the caches; size and clear work on the workspace folder", async () => {
    workspace.writeFile("global-packages/alpha/1.0.0/alpha.nupkg", "z".repeat(128));
    backend = await startBackend(workspace);

    const listed = await backend.api.listFolders();
    const global = listed.folders.find((item) => item.title === "Global Packages");
    // Checked before anything is cleared: an environment that redirects the folder must not lose real packages.
    expect(global?.path.toLowerCase().startsWith(workspace.path.toLowerCase())).toBe(true);
    const path = global!.path;
    const before = await backend.api.folderSize({ path });
    const cleared = await backend.api.clearFolders({ paths: [path] });
    const after = await backend.api.folderSize({ path });

    expectShape(listed, { folders: [{ title: "string", path: "string", clearable: "boolean" }] });
    expectShape(before, { exists: "boolean", bytes: "number" });
    expectShape(cleared, { folders: [{ path: "string", bytesFreed: "number", skipped: ["string"] }] });
    expect(listed.folders.filter((item) => item.clearable).map((item) => item.title)).toEqual([
      "Global Packages",
      "Package Cache",
      "HTTP Cache",
      "Temp"
    ]);
    expect(before.bytes).toBe(128);
    expect(cleared.folders[0]?.bytesFreed).toBe(128);
    expect(after).toEqual({ exists: true, bytes: 0 });
    expect(existsSync(path) && readdirSync(path).length === 0).toBe(true);
  });

  it("a folder that is not a cache is error 1109", async () => {
    backend = await startBackend(workspace);

    const error = await backend.api
      .clearFolders({ paths: [workspace.resolve("feed")] })
      .catch((reason: unknown) => reason);

    expect((error as ResponseError<unknown>).code).toBe(ErrorCodes.folderNotClearable);
    expect(existsSync(workspace.resolve("feed"))).toBe(true);
  });

  it("the handler answers credentials/request", async () => {
    const server = await PrivateFeed.start("Alpha", "5.0.0", "user", "s3cr3t-pass");
    try {
      workspace.writeSources(`    <add key="private" value="${server.indexUrl}" allowInsecureConnections="true" />`);
      backend = await startBackend(workspace);
      const asked: { source: string; isRetry: boolean }[] = [];
      backend.api.onCredentialsRequest((params) => {
        asked.push(params);
        return Promise.resolve({ username: "user", password: "s3cr3t-pass", cancelled: false });
      });

      const result = await backend.api.searchPackages({
        query: "Alpha",
        feed: "private",
        prerelease: false,
        skip: 0,
        take: 10
      });

      expect(result.packages.map((item) => item.id)).toEqual(["Alpha"]);
      expect(result.failures).toEqual([]);
      expect(asked.length).toBeGreaterThan(0);
      expectShape(asked[0], { source: "string", isRetry: "boolean" });
      expect(asked[0]?.source.startsWith(server.url)).toBe(true);
    } finally {
      await server.stop();
    }
  });
});
