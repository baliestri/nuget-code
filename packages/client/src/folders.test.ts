import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  calculateFolderSizes,
  clearCacheFolders,
  loadCacheFolders,
} from "./folders.js";
import type { NuGetClientLogger } from "./types.js";

describe("NuGet cache folders", () => {
  it("parses dotnet locals output", async () => {
    const log = logger();
    await expect(
      loadCacheFolders(
        {
          runDotnet: vi.fn().mockResolvedValue({
            code: 0,
            stdout:
              "http-cache: C:/Users/me/.nuget/http-cache\ninvalid\n global-packages: C:/Users/me/.nuget/packages",
          }),
        } as never,
        log,
      ),
    ).resolves.toEqual([
      {
        id: "http-cache:C:/Users/me/.nuget/http-cache",
        title: "http-cache",
        path: "C:/Users/me/.nuget/http-cache",
        selected: false,
      },
      {
        id: "global-packages:C:/Users/me/.nuget/packages",
        title: "global-packages",
        path: "C:/Users/me/.nuget/packages",
        selected: false,
      },
    ]);
    expect(log.information).toHaveBeenCalledWith(
      "nuget.folders",
      "Found 2 NuGet cache folder(s)",
    );
  });

  it("calculates folder sizes recursively and reports each folder", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nuget-folders-"));
    await fs.mkdir(path.join(root, "nested"));
    await fs.writeFile(path.join(root, "a.txt"), "1234");
    await fs.writeFile(path.join(root, "nested", "b.txt"), "12");
    const onFolderSized = vi.fn();

    const folders = await calculateFolderSizes(
      [{ id: "a", title: "A", path: root, selected: false }],
      logger(),
      { onFolderSized },
    );

    expect(folders[0]?.sizeBytes).toBe(6);
    expect(onFolderSized).toHaveBeenCalledWith(
      expect.objectContaining({ id: "a", sizeBytes: 6 }),
    );
  });

  it("clears existing cache folders and skips missing ones", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nuget-clear-"));
    await fs.mkdir(path.join(root, "child"));
    await fs.writeFile(path.join(root, "child", "a.txt"), "1");
    const log = logger();

    await clearCacheFolders(
      [
        { id: "a", title: "A", path: root, selected: true },
        {
          id: "missing",
          title: "Missing",
          path: path.join(root, "missing"),
          selected: true,
        },
      ],
      log,
    );

    await expect(fs.readdir(root)).resolves.toEqual([]);
    expect(log.warning).toHaveBeenCalledWith(
      "nuget.folders",
      `Cleared cache folder ${root}`,
    );
  });
});

function logger(): NuGetClientLogger {
  return {
    verbose: vi.fn(),
    information: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  };
}
