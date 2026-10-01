import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { NuGetClientLogger, NuGetClientSettings } from "#client/types";
import type { PackageFeed } from "#contracts/nuget";
import { networkFor } from "#client/client-network";

const defaultCredentialProviderName = "CredentialProvider.Microsoft";
const credentialCaches = new WeakMap<
  NuGetClientSettings,
  Map<string, string>
>();

export interface CredentialProviderCommand {
  command: string;
  argsPrefix: string[];
}

export interface FeedCredentialResult {
  authorizationHeader?: string | undefined;
  error?: string | undefined;
  providerFound: boolean;
}

export function findCredentialProviders(
  settings: NuGetClientSettings,
): CredentialProviderCommand[] {
  const providers: CredentialProviderCommand[] = [];
  const seen = new Set<string>();

  for (const candidate of providerCandidates(settings)) {
    const commands =
      candidate.kind === "command"
        ? [{ command: candidate.value, argsPrefix: [] }]
        : findProviderFiles(candidate.value).map((providerPath) =>
            providerCommand(providerPath, settings),
          );

    for (const command of commands) {
      const key = `${command.command}\0${command.argsPrefix.join("\0")}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      providers.push(command);
    }
  }

  return providers;
}

export function findCredentialProvider(
  settings: NuGetClientSettings,
): CredentialProviderCommand {
  return (
    findCredentialProviders(settings)[0] ?? {
      command: defaultCredentialProviderName,
      argsPrefix: [],
    }
  );
}

export async function getFeedAuthorizationHeader(options: {
  feed: PackageFeed;
  settings: NuGetClientSettings;
  logger: NuGetClientLogger;
  interactive?: boolean | undefined;
  retry?: boolean | undefined;
  signal?: AbortSignal | undefined;
}): Promise<FeedCredentialResult> {
  options.signal?.throwIfAborted();
  const network = networkFor(options.settings);
  let credentialCache = credentialCaches.get(options.settings);
  if (!credentialCache) {
    credentialCache = new Map();
    credentialCaches.set(options.settings, credentialCache);
  }
  const cacheKey = new URL(options.feed.url).toString();
  if (!options.retry && !options.interactive) {
    const cached = credentialCache.get(cacheKey);
    if (cached) {
      return { authorizationHeader: cached, providerFound: true };
    }
  }

  const requestKey = network.key([
    "credential",
    network.context(options.settings),
    cacheKey,
    options.retry === true,
    options.interactive === true,
  ]);
  const previousAuthorization = credentialCache.get(cacheKey);
  if (options.retry && previousAuthorization)
    network.invalidateAuthentication(options.settings);
  if (options.retry) credentialCache.delete(cacheKey);
  const cache = credentialCache;
  return network.authentication.run(
    requestKey,
    async (signal) => {
      const result = await resolveFeedAuthorizationHeader({
        ...options,
        signal,
      });
      signal.throwIfAborted();
      if (
        result.authorizationHeader &&
        result.authorizationHeader !==
          (cache.get(cacheKey) ?? previousAuthorization)
      )
        network.invalidateAuthentication(options.settings);
      if (result.authorizationHeader)
        cache.set(cacheKey, result.authorizationHeader);
      return result;
    },
    options.signal,
  );
}

async function resolveFeedAuthorizationHeader(options: {
  feed: PackageFeed;
  settings: NuGetClientSettings;
  logger: NuGetClientLogger;
  interactive?: boolean | undefined;
  retry?: boolean | undefined;
  signal?: AbortSignal | undefined;
}): Promise<FeedCredentialResult> {
  const result = await runCredentialProviders(
    findCredentialProviders(options.settings),
    options.feed.url,
    {
      interactive: options.interactive ?? false,
      retry: options.retry ?? false,
      signal: options.signal,
    },
  );

  const authorizationHeader = toBasicAuthorizationHeader(result.credentials);
  if (!authorizationHeader) {
    if (result.error) {
      options.logger.warning(
        "nuget.auth",
        `Credential provider failed for ${options.feed.name}: ${result.error}`,
      );
      return { providerFound: result.providerFound, error: result.error };
    }

    return {
      providerFound: result.providerFound,
      error: "Credential provider returned no username/password",
    };
  }

  return { authorizationHeader, providerFound: true };
}

function providerCandidates(
  settings: NuGetClientSettings,
): Array<{ kind: "path" | "command"; value: string }> {
  const configured = [
    ...settings.credentialProviderPaths,
    ...pathListFromEnv("NUGET_PLUGIN_PATHS"),
    ...pathListFromEnv("NUGET_CREDENTIALPROVIDERS_PATH"),
  ].map((value) => ({ kind: "path" as const, value }));

  const localAppData = process.env.LOCALAPPDATA;
  const nugetExeProviders = localAppData
    ? [
        {
          kind: "path" as const,
          value: path.join(localAppData, "NuGet", "CredentialProviders"),
        },
      ]
    : [];

  return [
    ...configured,
    { kind: "path", value: path.join(os.homedir(), ".nuget", "plugins") },
    ...nugetExeProviders,
    { kind: "command", value: defaultCredentialProviderName },
  ];
}

function pathListFromEnv(name: string): string[] {
  return (process.env[name] ?? "")
    .split(path.delimiter)
    .map((value) => value.trim())
    .filter(Boolean);
}

function findProviderFiles(candidatePath: string): string[] {
  if (!fs.existsSync(candidatePath)) {
    return [];
  }
  const stat = fs.statSync(candidatePath);
  if (stat.isFile()) {
    return [candidatePath];
  }
  if (!stat.isDirectory()) {
    return [];
  }

  const matches: string[] = [];
  const queue = [candidatePath];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs
        .readdirSync(current, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name));
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }
      if (entry.isFile() && isCredentialProviderFileName(entry.name)) {
        matches.push(entryPath);
      }
    }
  }
  return matches;
}

function isCredentialProviderFileName(fileName: string): boolean {
  if (!fileName.toLowerCase().startsWith("credentialprovider")) {
    return false;
  }
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".dll" || extension === ".exe") {
    return true;
  }
  return /^CredentialProvider(?:[A-Za-z0-9_-]+|\.[^.]+)?$/i.test(fileName);
}

function providerCommand(
  providerPath: string,
  settings: NuGetClientSettings,
): CredentialProviderCommand {
  if (providerPath.toLowerCase().endsWith(".dll")) {
    return { command: settings.dotnetPath, argsPrefix: [providerPath] };
  }
  return { command: providerPath, argsPrefix: [] };
}

async function runCredentialProviders(
  providers: CredentialProviderCommand[],
  feedUrl: string,
  options: {
    interactive: boolean;
    retry: boolean;
    signal?: AbortSignal | undefined;
  },
): Promise<{
  providerFound: boolean;
  credentials?: CredentialProviderCredentials | undefined;
  error?: string | undefined;
}> {
  if (providers.length === 0) {
    return { providerFound: false, error: "Credential provider was not found" };
  }

  let providerFound = false;
  let lastError: string | undefined;
  for (const provider of providers) {
    options.signal?.throwIfAborted();
    const result = await runCredentialProvider(provider, feedUrl, options);
    providerFound ||= result.providerFound;

    if (result.credentials) {
      return result;
    }
    if (result.notApplicable) {
      continue;
    }
    if (!result.providerFound) {
      lastError = result.error;
      continue;
    }
    return result;
  }

  return {
    providerFound,
    error:
      lastError ??
      (providerFound
        ? "No credential provider was applicable"
        : "Credential provider was not found"),
  };
}

async function runCredentialProvider(
  provider: CredentialProviderCommand,
  feedUrl: string,
  options: {
    interactive: boolean;
    retry: boolean;
    signal?: AbortSignal | undefined;
  },
): Promise<{
  providerFound: boolean;
  credentials?: CredentialProviderCredentials | undefined;
  error?: string | undefined;
  notApplicable?: boolean | undefined;
}> {
  const result = await runCredentialProviderCommand(
    provider,
    genericCredentialProviderArgs(provider, feedUrl, options),
    options.signal,
  );
  if (
    result.error === "Credential provider output did not contain credentials" &&
    isMicrosoftCredentialProvider(provider)
  ) {
    return runCredentialProviderCommand(
      provider,
      microsoftCredentialProviderArgs(provider, feedUrl, options),
      options.signal,
    );
  }
  return result;
}

function genericCredentialProviderArgs(
  provider: CredentialProviderCommand,
  feedUrl: string,
  options: { interactive: boolean; retry: boolean },
): string[] {
  const args = [...provider.argsPrefix, "-Uri", feedUrl];
  if (!options.interactive) {
    args.push("-NonInteractive");
  }
  if (options.retry) {
    args.push("-IsRetry");
  }
  return args;
}

function microsoftCredentialProviderArgs(
  provider: CredentialProviderCommand,
  feedUrl: string,
  options: { interactive: boolean; retry: boolean },
): string[] {
  const args = [
    ...provider.argsPrefix,
    "-U",
    feedUrl,
    "-N",
    options.interactive ? "false" : "true",
    "-F",
    "Json",
  ];
  if (options.retry) {
    args.push("-I", "true");
  }
  return args;
}

function isMicrosoftCredentialProvider(
  provider: CredentialProviderCommand,
): boolean {
  return [provider.command, ...provider.argsPrefix].some((value) =>
    value.toLowerCase().includes("credentialprovider.microsoft"),
  );
}

function runCredentialProviderCommand(
  provider: CredentialProviderCommand,
  args: string[],
  signal?: AbortSignal,
): Promise<{
  providerFound: boolean;
  credentials?: CredentialProviderCredentials | undefined;
  error?: string | undefined;
  notApplicable?: boolean | undefined;
}> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const child = spawn(provider.command, args, {
      shell: false,
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    let launchError: string | undefined;
    const abort = () => {
      child.kill();
    };
    signal?.addEventListener("abort", abort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.resume();
    child.on("error", (error: NodeJS.ErrnoException) => {
      launchError =
        error.code && /^[A-Z0-9_]+$/.test(error.code) ? error.code : "UNKNOWN";
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      if (launchError) {
        resolve({
          providerFound:
            provider.argsPrefix.length > 0 || launchError !== "ENOENT",
          error: `Could not start credential provider executable ${path.basename(provider.command)} (${launchError})`,
        });
        return;
      }
      const output = Buffer.concat(stdout).toString("utf8").trim();
      if (code === 1 && !output) {
        resolve({ providerFound: true, notApplicable: true });
        return;
      }
      if (code !== 0) {
        resolve({
          providerFound: true,
          error: `Credential provider exited with ${code}`,
        });
        return;
      }

      try {
        resolve({
          providerFound: true,
          credentials: parseCredentialProviderOutput(output),
        });
      } catch (error) {
        resolve({
          providerFound: true,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  });
}

function parseCredentialProviderOutput(
  output: string,
): CredentialProviderCredentials {
  try {
    return JSON.parse(output) as CredentialProviderCredentials;
  } catch {
    const parsed = parseCredentialJsonCandidates(output);
    const credentials = parsed.find(hasCredentialFields) ?? parsed[0];
    if (credentials) {
      return credentials;
    }
    const textCredentials = parseCredentialTextOutput(output);
    if (textCredentials) {
      return textCredentials;
    }
    throw new Error("Credential provider output did not contain credentials");
  }
}

function parseCredentialJsonCandidates(
  output: string,
): CredentialProviderCredentials[] {
  const candidates: CredentialProviderCredentials[] = [];
  for (
    let start = output.indexOf("{");
    start >= 0;
    start = output.indexOf("{", start + 1)
  ) {
    const end = findJsonObjectEnd(output, start);
    if (end < 0) {
      continue;
    }

    try {
      const value = JSON.parse(output.slice(start, end + 1));
      if (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
      ) {
        candidates.push(value as CredentialProviderCredentials);
      }
    } catch {
      continue;
    }
  }
  return candidates;
}

function findJsonObjectEnd(output: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < output.length; index++) {
    const char = output[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = inString;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      depth++;
      continue;
    }
    if (char === "}") {
      depth--;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function hasCredentialFields(
  credentials: CredentialProviderCredentials,
): boolean {
  return (
    (credentials.Password !== undefined ||
      credentials.password !== undefined) &&
    (credentials.Username !== undefined ||
      credentials.username !== undefined ||
      credentials.UserName !== undefined)
  );
}

function parseCredentialTextOutput(
  output: string,
): CredentialProviderCredentials | undefined {
  const password = readCredentialOutputValue(output, "password");
  if (!password) {
    return undefined;
  }

  return {
    Username:
      readCredentialOutputValue(output, "username") ??
      readCredentialOutputValue(output, "user name") ??
      "VssSessionToken",
    Password: password,
  };
}

function readCredentialOutputValue(
  output: string,
  key: string,
): string | undefined {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    `^\\s*${escapedKey}\\s*[:=]\\s*(.+?)\\s*$`,
    "im",
  ).exec(output);
  const value = match?.[1]?.trim();
  if (!value) {
    return undefined;
  }
  return value.replace(/^["']|["']$/g, "");
}

function toBasicAuthorizationHeader(
  credentials: CredentialProviderCredentials | undefined,
): string | undefined {
  const username =
    credentials?.Username ??
    credentials?.username ??
    credentials?.UserName ??
    (credentials?.Password || credentials?.password
      ? "VssSessionToken"
      : undefined);
  const password = credentials?.Password ?? credentials?.password;
  if (!username || !password) {
    return undefined;
  }
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

interface CredentialProviderCredentials {
  Username?: string | undefined;
  UserName?: string | undefined;
  Password?: string | undefined;
  username?: string | undefined;
  password?: string | undefined;
}
