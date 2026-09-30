import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import type { NuGetConfigFile, PackageFeed } from "#contracts/nuget";
import type {
  NuGetClientSettings,
  NuGetClientLogger,
  NuGetWorkspaceConfigOptions,
} from "#client/types";
import { parseXml } from "@rgrove/parse-xml";
import { decodeProjectText } from "#client/project-files";
import { credentialSourceName } from "#client/source-edits";

export async function loadSources(
  settings: NuGetClientSettings,
  logger: NuGetClientLogger,
  options: NuGetWorkspaceConfigOptions = {},
): Promise<NuGetConfigFile[]> {
  const workspacePaths = (options.workspaceConfigPaths ?? []).filter(
    (file) =>
      options.projectPaths === undefined ||
      options.projectPaths.some((project) =>
        isParent(path.dirname(file), path.dirname(project)),
      ),
  );
  const defaults = getDefaultConfigPaths();
  const paths = unique([
    ...defaults,
    ...workspacePaths.sort(
      (a, b) =>
        a.split(path.sep).length - b.split(path.sep).length ||
        a.localeCompare(b),
    ),
    ...settings.extraConfigPaths,
  ]);
  const configs = await Promise.all(
    paths.map((configPath) => readConfig(configPath, logger, options)),
  );
  const existingConfigs = configs.filter(
    (config): config is NuGetConfigFile => config !== undefined,
  );
  const effective = createEffectiveConfig(
    existingConfigs,
    options,
    new Set([...defaults, ...settings.extraConfigPaths]),
  );

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
    const bytes = await fs.readFile(configPath);
    const xml = decodeProjectText(bytes).text;
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
      ).map((element) => credentialSourceName(element.name)),
    );
    const disabled = new Set(disabledSources.map((source) => source.key));
    const feeds = packageSources
      .filter(hasPackageSource)
      .map<PackageFeed>((source) => ({
        sourceAttributes: Object.fromEntries(
          Object.entries(source).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
          ),
        ),
        declaredUrl: source.value,
        id: `${configPath}:${source.key}`,
        name: source.key,
        url:
          path.isAbsolute(source.value) ||
          /^[a-z][a-z0-9+.-]*:\/\//i.test(source.value)
            ? source.value
            : path.resolve(path.dirname(configPath), source.value),
        enabled: !disabled.has(source.key),
        allowInsecure:
          String(source.allowInsecureConnections).toLowerCase() === "true",
        sourceConfigId: configPath,
        hasCredentials: credentialKeys.has(source.key),
      }));

    return {
      revision: createHash("sha256").update(bytes).digest("hex"),
      mappingNames: childElements(
        firstElement(configuration, "packageSourceMapping"),
        "packageSource",
      )
        .map((element) => element.attributes.key)
        .filter((value): value is string => !!value),
      sourceDirectives: childElements(
        firstElement(configuration, "packageSources"),
      )
        .filter((element) => ["add", "remove", "clear"].includes(element.name))
        .map((element) => ({
          action: element.name as "add" | "remove" | "clear",
          ...(element.attributes.key ? { key: element.attributes.key } : {}),
        })),
      disabledDirectives: childElements(
        firstElement(configuration, "disabledPackageSources"),
      )
        .filter((element) => ["add", "remove", "clear"].includes(element.name))
        .map((element) => ({
          action: element.name as "add" | "remove" | "clear",
          ...(element.attributes.key ? { key: element.attributes.key } : {}),
          ...(element.attributes.value !== undefined ? { disabled: true } : {}),
        })),
      credentialNames: [...credentialKeys],
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

function createEffectiveConfig(
  configs: NuGetConfigFile[],
  options: NuGetWorkspaceConfigOptions,
  explicit: ReadonlySet<string>,
): NuGetConfigFile {
  const union = new Map<string, PackageFeed>();
  for (const project of options.projectPaths?.length
    ? options.projectPaths
    : [undefined]) {
    const feeds = new Map<string, PackageFeed>();
    const disabled = new Map<string, boolean>();
    const credentials = new Set<string>();
    for (const config of configs) {
      if (
        project &&
        config.origin === "workspace" &&
        !explicit.has(config.path) &&
        !isParent(path.dirname(config.path), path.dirname(project))
      )
        continue;
      for (const directive of config.sourceDirectives ?? []) {
        if (directive.action === "clear") feeds.clear();
        else if (directive.action === "remove" && directive.key)
          feeds.delete(directive.key);
        else if (directive.key) {
          const feed = [...config.feeds]
            .reverse()
            .find((feed) => feed.name === directive.key);
          if (feed) feeds.set(feed.name, feed);
        }
      }
      for (const directive of config.disabledDirectives ?? []) {
        if (directive.action === "clear") disabled.clear();
        else if (directive.action === "remove" && directive.key)
          disabled.delete(directive.key);
        else if (directive.key)
          disabled.set(directive.key, directive.disabled ?? false);
      }
      for (const name of config.credentialNames ?? []) credentials.add(name);
    }
    for (const feed of feeds.values()) {
      const key = `${feed.name}\0${feed.url}`;
      const previous = union.get(key);
      union.set(key, {
        ...feed,
        enabled: (previous?.enabled ?? false) || !disabled.get(feed.name),
        hasCredentials: credentials.has(feed.name),
      });
    }
  }
  if (!configs.length) {
    union.set("nuget.org", {
      id: "effective:nuget.org",
      name: "nuget.org",
      url: "https://api.nuget.org/v3/index.json",
      enabled: true,
    });
  }

  const feeds = [...union.values()].map((feed) => ({
    ...feed,
    id: `effective:${feed.name}${[...union.values()].filter((item) => item.name === feed.name).length > 1 ? `:${createHash("sha256").update(feed.url).digest("hex").slice(0, 12)}` : ""}`,
  }));
  return {
    id: "__effective__",
    revision: createHash("sha256")
      .update(
        JSON.stringify([
          configs.map((config) => [config.path, config.revision]),
          options.projectPaths,
        ]),
      )
      .digest("hex"),
    name: "[Effective NuGet.config]",
    path: "",
    origin: "effective",
    hasCredentials: feeds.some((feed) => feed.hasCredentials),
    scope: "Merged NuGet configuration",
    feeds,
  };
}

function getConfigOrigin(
  configPath: string,
  workspaceFolderPaths: string[],
): NuGetConfigFile["origin"] {
  if (workspaceFolderPaths.some((folder) => isParent(folder, configPath)))
    return "workspace";
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

function isParent(parent: string, child: string): boolean {
  const normalize = (value: string) =>
    process.platform === "win32"
      ? path.resolve(value).toLowerCase()
      : path.resolve(value);
  const relative = path.relative(normalize(parent), normalize(child));
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
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
