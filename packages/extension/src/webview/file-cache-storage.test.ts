import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { FileCacheStorage } from "./file-cache-storage";

it("atomically replaces entries, preserves committed data on rename failure and cleans only managed orphans", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nuget-cache-"));
  const key = `${"a".repeat(64)}.json`;
  const storage = new FileCacheStorage(root);
  try {
    await storage.write(key, "old");
    const rename = vi
      .spyOn(fs, "rename")
      .mockRejectedValueOnce(new Error("disk failure"));
    await expect(storage.write(key, "new")).rejects.toThrow("disk failure");
    rename.mockRestore();
    expect(await storage.read(key)).toBe("old");
    expect(await fs.readdir(root)).toEqual([key]);
    await storage.write(key, "new");
    const orphan = `${"b".repeat(64)}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(path.join(root, orphan), "incomplete");
    await fs.writeFile(path.join(root, "user.tmp"), "preserve");
    expect(await storage.list()).toEqual([key]);
    expect(await storage.read(key)).toBe("new");
    expect((await fs.readdir(root)).sort()).toEqual([key, "user.tmp"].sort());
    await expect(storage.read("../other.json")).rejects.toThrow(
      "Invalid managed cache key",
    );
  } finally {
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  }
});

it("does not follow a managed-name symlink to data outside its directory", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nuget-cache-link-"));
  const outside = await fs.mkdtemp(
    path.join(os.tmpdir(), "nuget-cache-outside-"),
  );
  try {
    const storage = new FileCacheStorage(root);
    const key = `${"c".repeat(64)}.json`;
    // Junctions exercise the same refusal without requiring Windows symlink privilege.
    await fs.symlink(
      outside,
      path.join(root, key),
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(await storage.list()).toEqual([]);
    expect(await storage.read(key)).toBeUndefined();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

it("discards oversized managed files before reading their payload", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nuget-cache-large-"));
  const key = `${"d".repeat(64)}.json`;
  try {
    const storage = new FileCacheStorage(root, 16);
    await fs.writeFile(path.join(root, key), "x".repeat(32));
    expect(await storage.read(key)).toBeUndefined();
    expect(await storage.list()).toEqual([]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
