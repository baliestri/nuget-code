import { spawn } from "node:child_process";
import path from "node:path";
import { NuGetClientSettings, NuGetClientLogger } from "#client/types";
import { maskSecret } from "#client/utils";

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  failure?: { kind: "launch"; code: string };
}

export interface CommandOptions {
  cwd?: string | undefined;
  signal?: AbortSignal | undefined;
}

export class NuGetCli {
  constructor(
    private readonly settings: NuGetClientSettings,
    private readonly logger: NuGetClientLogger,
  ) {}

  runDotnet(
    args: string[],
    cwd?: string | undefined,
    options: Omit<CommandOptions, "cwd"> = {},
  ): Promise<CommandResult> {
    return this.run(this.settings.dotnetPath, args, { cwd, ...options });
  }

  runNuget(
    args: string[],
    cwd?: string | undefined,
    options: Omit<CommandOptions, "cwd"> = {},
  ): Promise<CommandResult> {
    return this.run(this.settings.nugetPath, args, { cwd, ...options });
  }

  private run(
    command: string,
    args: string[],
    options: CommandOptions,
  ): Promise<CommandResult> {
    const safeCommand = `${command} ${args.map(maskSecret).join(" ")}`;
    this.logger.verbose("nuget.cli", `Running ${safeCommand}`);

    return new Promise((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(abortError());
        return;
      }

      const env: NodeJS.ProcessEnv = {
        ...process.env,
        DOTNET_CLI_UI_LANGUAGE: "en-US",
      };
      if (this.settings.credentialProviderPaths.length > 0) {
        env.NUGET_PLUGIN_PATHS = this.settings.credentialProviderPaths.join(
          process.platform === "win32" ? ";" : ":",
        );
      }

      const launch = () =>
        spawn(command, args, {
          cwd: this.resolveCwd(options.cwd),
          env,
          shell: false,
          windowsHide: true,
        });
      let child: ReturnType<typeof launch>;
      try {
        child = launch();
      } catch (error) {
        const failure = commandLaunchFailure(error);
        this.logger.error(
          "nuget.cli",
          `${safeCommand} failed: ${failure.stderr}`,
        );
        resolve(failure);
        return;
      }
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let settled = false;
      let aborted = false;
      let launchFailure: CommandResult | undefined;
      const finish = (result: CommandResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        options.signal?.removeEventListener("abort", abort);
        if (aborted) reject(abortError());
        else resolve(result);
      };
      const abort = (): void => {
        if (settled || aborted) return;
        aborted = true;
        this.logger.verbose("nuget.cli", `${safeCommand} aborted`);
        child.kill();
      };

      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.on("error", (error) => {
        this.logger.error(
          "nuget.cli",
          `${safeCommand} failed: ${error.message}`,
        );

        launchFailure = commandLaunchFailure(error);
      });
      child.on("close", (code) => {
        if (aborted || launchFailure) {
          finish(launchFailure ?? { code, stdout: "", stderr: "" });
          return;
        }
        const result = {
          code,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
        };

        if (code === 0) {
          this.logger.verbose("nuget.cli", `${safeCommand} completed`);
        } else {
          this.logger.warning(
            "nuget.cli",
            `${safeCommand} exited with ${code}: ${result.stderr.trim()}`,
          );
        }

        finish(result);
      });
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
    });
  }

  private resolveCwd(fallback: string | undefined): string | undefined {
    const cwd = fallback ?? this.settings.workspacePath;
    if (!cwd) {
      return undefined;
    }

    return process.platform === "win32" ? sanitizeWindowsCwd(cwd) : cwd;
  }
}

function abortError(): Error {
  const error = new Error("The command was aborted.");
  error.name = "AbortError";
  return error;
}

function commandLaunchFailure(error: unknown): CommandResult {
  return {
    code: -1,
    stdout: "",
    stderr:
      error instanceof Error
        ? error.message
        : "Could not start the executable.",
    failure: {
      kind: "launch",
      code: (error as NodeJS.ErrnoException)?.code ?? "UNKNOWN",
    },
  };
}

function sanitizeWindowsCwd(cwd: string): string {
  const normalized = path.win32.normalize(cwd);
  if (normalized.startsWith("\\\\?\\UNC\\")) {
    return `\\\\${normalized.slice(8)}`;
  }
  if (normalized.startsWith("\\\\?\\")) {
    return normalized.slice(4);
  }

  return normalized;
}
