import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import type { NuGetConfigFile, PackageFeed } from "#contracts/nuget";
import type {
  NuGetClientSettings,
  NuGetClientLogger,
  NuGetWorkspaceConfigOptions,
} from "#client/types";
import { parseXml } from "@rgrove/parse-xml";

export async function loadSources(
  settings: NuGetClientSettings,
  logger: NuGetClientLogger,
  options: NuGetWorkspaceConfigOptions = {},
): Promise<NuGetConfigFile[]> {
  const paths = unique([
    ...getDefaultConfigPaths(),
    ...settings.extraConfigPaths,
    ...(options.workspaceConfigPaths ?? []),
  ]);
  const configs = await Promise.all(
    paths.map((configPath) => readConfig(configPath, logger, options)),
  );
  const existingConfigs = configs.filter(
    (config): config is NuGetConfigFile => config !== undefined,
  );
  const effective = createEffectiveConfig(existingConfigs);

  logger.information(
    "nuget.config",
    `Loaded ${existingConfigs.length} NuGet config file(s) and ${effective.feeds.length} effective feed(s)`,
  );

  return [effective, ...existingConfigs];
}

function getDefaultConfigPaths(): string[] {
  const programFilesX86 = process.env["ProgramFiles(x86)"];
  const programFiles = process.env.ProgramFiles;
  const appData = process.env.APPDATA;
  const paths = [
    ...getMachineConfigPaths(programFilesX86),
    ...getMachineConfigPaths(programFiles),
    appData ? path.join(appData, "NuGet", "NuGet.Config") : "",
    path.join(os.homedir(), ".nuget", "NuGet", "NuGet.Config"),
  ];
  return paths.filter(Boolean);
}

function getMachineConfigPaths(programFilesPath: string | undefined): string[] {
  if (!programFilesPath) {
    return [];
  }

  const configRoot = path.join(programFilesPath, "NuGet", "Config");
  if (!fsSync.existsSync(configRoot)) {
    return [];
  }

  return fsSync
    .readdirSync(configRoot, { withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".config"),
    )
    .map((entry) => path.join(configRoot, entry.name));
}

async function readConfig(
  configPath: string,
  logger: NuGetClientLogger,
  options: NuGetWorkspaceConfigOptions,
): Promise<NuGetConfigFile | undefined> {
  if (!fsSync.existsSync(configPath)) {
    return undefined;
  }

  try {
    const xml = await fs.readFile(configPath, "utf8");
    const doc = parseXml(xml) as XmlContainer;
    const configuration = firstElement(doc, "configuration");
    const packageSources = childElements(
      firstElement(configuration, "packageSources"),
      "add",
    ).map((element) => element.attributes);
    const disabledSources = childElements(
      firstElement(configuration, "disabledPackageSources"),
      "add",
    ).map((element) => element.attributes);
    const credentialKeys = new Set(
      childElements(
        firstElement(configuration, "packageSourceCredentials"),
      ).map((element) => element.name),
    );
    const disabled = new Set(
      disabledSources
        .filter((source) => String(source.value).toLowerCase() === "true")
        .map((source) => source.key),
    );
    const feeds = packageSources
      .filter(hasPackageSource)
      .map<PackageFeed>((source) => ({
        id: `${configPath}:${source.key}`,
        name: source.key,
        url: source.value,
        enabled: !disabled.has(source.key),
        allowInsecure:
          String(source.allowInsecureConnections).toLowerCase() === "true",
        sourceConfigId: configPath,
        hasCredentials: credentialKeys.has(source.key),
      }));

    return {
      id: configPath,
      name: path.basename(configPath),
      path: configPath,
      origin: getConfigOrigin(configPath, options.workspaceFolderPaths ?? []),
      hasCredentials: feeds.some((feed) => credentialKeys.has(feed.name)),
      scope: path.dirname(configPath),
      feeds,
    };
  } catch (error) {
    logger.warning(
      "nuget.config",
      `Failed to read ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

function createEffectiveConfig(configs: NuGetConfigFile[]): NuGetConfigFile {
  const feeds = new Map<string, PackageFeed>();
  for (const config of configs) {
    for (const feed of config.feeds) {
      feeds.set(feed.name, { ...feed, id: `effective:${feed.name}` });
    }
  }
  if (!feeds.has("nuget.org")) {
    feeds.set("nuget.org", {
      id: "effective:nuget.org",
      name: "nuget.org",
      url: "https://api.nuget.org/v3/index.json",
      enabled: true,
    });
  }

  return {
    id: "__effective__",
    name: "[Effective NuGet.config]",
    path: "",
    origin: "effective",
    hasCredentials: configs.some((config) => config.hasCredentials),
    scope: "Merged NuGet configuration",
    feeds: Array.from(feeds.values()),
  };
}

function getConfigOrigin(
  configPath: string,
  workspaceFolderPaths: string[],
): NuGetConfigFile["origin"] {
  const lower = configPath.toLowerCase();
  if (lower.includes("\\program files") || lower.includes("/program files")) {
    return "machine";
  }
  if (lower.includes(`${os.homedir().toLowerCase()}`)) {
    return "user";
  }
  if (
    workspaceFolderPaths.some((folderPath) =>
      lower.startsWith(folderPath.toLowerCase()),
    )
  ) {
    return "workspace";
  }
  return "unknown";
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function hasPackageSource(
  source: Record<string, string | undefined>,
): source is Record<string, string | undefined> & {
  key: string;
  value: string;
} {
  return Boolean(source.key && source.value);
}

function firstElement(
  container: XmlContainer | undefined,
  name: string,
): XmlElement | undefined {
  return childElements(container, name)[0];
}

function childElements(
  container: XmlContainer | undefined,
  name?: string,
): XmlElement[] {
  return (container?.children ?? []).filter(
    (child): child is XmlElement =>
      "name" in child && (name === undefined || child.name === name),
  );
}

interface XmlContainer {
  children?: XmlChild[] | undefined;
}

interface XmlElement extends XmlContainer {
  name: string;
  attributes: Record<string, string | undefined>;
}

type XmlChild = XmlElement | XmlContainer;
