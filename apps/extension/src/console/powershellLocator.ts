import { posix, win32 } from "node:path";

export interface LocatePowerShellInput {
  /** The `nuget.console.powershellPath` setting; empty when unset. */
  configured: string;
  /** The `PATH` of the extension host. */
  path: string;
  /** The home folder of the user, under which the .NET global tools are installed. */
  home: string;
  /** `process.platform`: decides the name of the executable and how paths are written. */
  platform: string;
  /** The least version the console module loads in, such as `7.6.0`. */
  minimum: string;
  exists(path: string): boolean;
  /** What the executable answers to `--version`; undefined when it cannot be run. */
  versionOf(path: string): Promise<string | undefined>;
}

export type PowerShellLocation =
  | { kind: "found"; path: string; version: string }
  /** No PowerShell was found anywhere. */
  | { kind: "missing" }
  /** The newest PowerShell found is older than the module needs. */
  | { kind: "tooOld"; path: string; version: string }
  /** The setting points to something that does not exist or is not a PowerShell that runs. */
  | { kind: "badSetting"; path: string };

/** The numbers of a version, such as `PowerShell 7.6.0` or `7.7.0-preview.1`; undefined when there are none. */
export function versionNumbers(text: string | undefined): [number, number, number] | undefined {
  const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(text ?? "");
  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

function isAtLeast(version: readonly number[], minimum: readonly number[]): boolean {
  for (let index = 0; index < minimum.length; index++) {
    const difference = (version[index] ?? 0) - (minimum[index] ?? 0);
    if (difference !== 0) {
      return difference > 0;
    }
  }

  return true;
}

/** Where a PowerShell may be, in the order they are tried: the `PATH`, then the .NET global tools. */
export function powerShellCandidates(input: Pick<LocatePowerShellInput, "path" | "home" | "platform">): string[] {
  const paths = input.platform === "win32" ? win32 : posix;
  const name = input.platform === "win32" ? "pwsh.exe" : "pwsh";
  const folders = input.path
    .split(paths.delimiter)
    .map((folder) => folder.trim().replace(/^"(.*)"$/, "$1"))
    .filter((folder) => folder !== "");
  // Where `dotnet tool install --global` puts it. It is on the PATH of new processes only, so a PowerShell
  // installed while the editor runs would not be found without looking here.
  if (input.home !== "") {
    folders.push(paths.join(input.home, ".dotnet", "tools"));
  }

  return [...new Set(folders.map((folder) => paths.join(folder, name)))];
}

/**
 * Finds the PowerShell the console runs in: the one of the setting, which is not second-guessed, else the
 * first in the `PATH` or among the .NET global tools that is new enough for the module.
 */
export async function locatePowerShell(input: LocatePowerShellInput): Promise<PowerShellLocation> {
  const minimum = versionNumbers(input.minimum) ?? [0, 0, 0];

  if (input.configured !== "") {
    const version = input.exists(input.configured) ? await input.versionOf(input.configured) : undefined;
    const numbers = versionNumbers(version);
    if (version === undefined || numbers === undefined) {
      return { kind: "badSetting", path: input.configured };
    }

    return { kind: isAtLeast(numbers, minimum) ? "found" : "tooOld", path: input.configured, version };
  }

  let old: PowerShellLocation | undefined;
  for (const path of powerShellCandidates(input)) {
    if (!input.exists(path)) {
      continue;
    }

    const version = await input.versionOf(path);
    const numbers = versionNumbers(version);
    if (version === undefined || numbers === undefined) {
      continue;
    }

    if (isAtLeast(numbers, minimum)) {
      return { kind: "found", path, version };
    }

    // An older one does not end the search: a newer one may come later, among the .NET tools for example.
    old ??= { kind: "tooOld", path, version };
  }

  return old ?? { kind: "missing" };
}

/** The command that installs the PowerShell the module was built for, as a .NET global tool. */
export function installCommand(dotnetPath: string, version: string): { command: string; args: string[] } {
  return { command: dotnetPath, args: ["tool", "install", "--global", "PowerShell", "--version", version] };
}

export const PowerShellActions = {
  install: "Install",
  openSettings: "Open Settings",
  howToInstall: "How to Install"
} as const;

export type PowerShellAction = (typeof PowerShellActions)[keyof typeof PowerShellActions];

/** What the user is told when there is no PowerShell to open the console with, and what they may do. */
export function powerShellNotice(
  location: Exclude<PowerShellLocation, { kind: "found" }>,
  minimum: string,
  dotnetPath: string | undefined
): { message: string; actions: PowerShellAction[] } {
  if (location.kind === "badSetting") {
    return {
      message: `The PowerShell set in nuget.console.powershellPath was not found or does not run: ${location.path}`,
      actions: [PowerShellActions.openSettings]
    };
  }

  const found =
    location.kind === "tooOld"
      ? `The Package Manager Console needs PowerShell ${minimum} or newer; ${location.path} is ${location.version}.`
      : `The Package Manager Console needs PowerShell ${minimum} or newer, and none was found.`;
  if (dotnetPath === undefined) {
    return { message: found, actions: [PowerShellActions.howToInstall, PowerShellActions.openSettings] };
  }

  const { command, args } = installCommand("dotnet", minimum);
  return {
    message: `${found} Install runs: ${command} ${args.join(" ")}`,
    actions: [PowerShellActions.install, PowerShellActions.howToInstall, PowerShellActions.openSettings]
  };
}

/** The version of PowerShell the module was built for: the one written beside it when it was built. */
export function moduleVersion(json: string): string | undefined {
  try {
    const parsed = JSON.parse(json) as { powershell?: unknown };
    return typeof parsed.powershell === "string" && versionNumbers(parsed.powershell) !== undefined
      ? parsed.powershell
      : undefined;
  } catch {
    return undefined;
  }
}
