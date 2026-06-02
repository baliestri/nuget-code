import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { NuGetCli } from "#client/cli";
import { NuGetClientLogger } from "#client/types";
import { NuGetCacheFolder } from "#contracts/nuget";

export async function loadCacheFolders(
  cli: NuGetCli,
  logger: NuGetClientLogger,
): Promise<NuGetCacheFolder[]> {
  const result = await cli.runDotnet(["nuget", "locals", "all", "--list"]);
  const folders = parseLocals(result.stdout);

  if (folders.length > 0) {
    logger.information(
      "nuget.folders",
      `Found ${folders.length} NuGet cache folder(s)`,
    );

    return folders;
  }

  logger.warning("nuget.folders", "Falling back to common NuGet cache folders");
  return [];
}

export async function calculateFolderSizes(
  folders: NuGetCacheFolder[],
  logger: NuGetClientLogger,
  options: {
    onFolderSized?: (folder: NuGetCacheFolder) => void | Promise<void>;
  } = {},
): Promise<NuGetCacheFolder[]> {
  const sized = await Promise.all(
    folders.map(async (folder) => {
      const sizedFolder = {
        ...folder,
        sizeBytes: await getDirectorySize(folder.path),
      };
      await options.onFolderSized?.(sizedFolder);
      return sizedFolder;
    }),
  );

  logger.information("nuget.folders", "Recalculated NuGet cache folder sizes");

  return sized;
}

export async function clearCacheFolders(
  folders: NuGetCacheFolder[],
  logger: NuGetClientLogger,
): Promise<void> {
  for (const folder of folders) {
    if (!fsSync.existsSync(folder.path)) {
      continue;
    }

    const entries = await fs.readdir(folder.path);
    await Promise.all(
      entries.map((entry) =>
        fs.rm(path.join(folder.path, entry), {
          force: true,
          recursive: true,
          maxRetries: 2,
        }),
      ),
    );

    logger.warning("nuget.folders", `Cleared cache folder ${folder.path}`);
  }
}

function parseLocals(stdout: string): NuGetCacheFolder[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(":");
      if (separator < 0) {
        return undefined;
      }

      const title = line.slice(0, separator).trim();
      const folderPath = line.slice(separator + 1).trim();
      if (!title || !folderPath) {
        return undefined;
      }

      return {
        id: `${title}:${folderPath}`,
        title,
        path: folderPath,
        selected: false,
      };
    })
    .filter((folder): folder is NuGetCacheFolder => folder !== undefined);
}

async function getDirectorySize(folderPath: string): Promise<number> {
  try {
    const stat = await fs.stat(folderPath);

    if (!stat.isDirectory()) {
      return stat.size;
    }
  } catch {
    return 0;
  }

  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(folderPath, entry.name);
      if (entry.isDirectory()) {
        return getDirectorySize(entryPath);
      }

      try {
        return (await fs.stat(entryPath)).size;
      } catch {
        return 0;
      }
    }),
  );

  return sizes.reduce((total, size) => total + size, 0);
}
