import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { cachePolicy } from "#client/cache";
import {
  cacheFilePattern,
  type CacheStorage,
} from "#extension/webview/cache-store";

const temporaryPattern = /^[a-f0-9]{64}\.([1-9][0-9]*)\.[a-f0-9-]{36}\.tmp$/;
const activeTemporaries = new Set<string>();
function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}
export class FileCacheStorage implements CacheStorage {
  constructor(
    private readonly root: string,
    private readonly maxFileBytes: number = cachePolicy.workspaceBytes,
  ) {}
  private async directory(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(this.root);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("Cache directory is not an ordinary directory.");
  }
  private file(key: string): string {
    if (!cacheFilePattern.test(key))
      throw new Error("Invalid managed cache key.");
    return path.join(this.root, key);
  }
  async list(): Promise<readonly string[]> {
    await this.directory();
    const entries = await fs.readdir(this.root, { withFileTypes: true });
    for (const entry of entries) {
      const match = temporaryPattern.exec(entry.name);
      const file = path.join(this.root, entry.name);
      if (!match || entry.isDirectory() || activeTemporaries.has(file))
        continue;
      const owner = Number(match[1]);
      if (owner === process.pid || !processExists(owner))
        await fs.unlink(file).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
    }
    return entries
      .filter((entry) => entry.isFile() && cacheFilePattern.test(entry.name))
      .map((entry) => entry.name);
  }
  async read(key: string): Promise<string | undefined> {
    await this.directory();
    const file = this.file(key);
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) return undefined;
      if (stat.size > this.maxFileBytes) {
        await fs.unlink(file);
        return undefined;
      }
      return await fs.readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
  async write(key: string, payload: string): Promise<void> {
    await this.directory();
    const destination = this.file(key);
    const temporary = path.join(
      this.root,
      `${key.slice(0, -5)}.${process.pid}.${randomUUID()}.tmp`,
    );
    activeTemporaries.add(temporary);
    try {
      await fs.writeFile(temporary, payload, { flag: "wx", mode: 0o600 });
      await fs.rename(temporary, destination);
    } finally {
      activeTemporaries.delete(temporary);
      await fs.unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }
  async remove(key: string): Promise<void> {
    await this.directory();
    await fs.unlink(this.file(key)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
