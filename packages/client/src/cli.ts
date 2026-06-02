import { spawn } from "node:child_process";
import path from "node:path";
import { NuGetClientSettings, NuGetClientLogger } from "#client/types";
import { maskSecret } from "#client/utils";

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
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

    return new Promise((resolve) => {
      if (options.signal?.aborted) {
        resolve({ code: -1, stdout: "", stderr: "aborted" });
        return;
      }

      const env = { ...process.env };
      if (this.settings.credentialProviderPaths.length > 0) {
        env.NUGET_PLUGIN_PATHS = this.settings.credentialProviderPaths.join(
          process.platform === "win32" ? ";" : ":",
        );
      }

      const child = spawn(command, args, {
        cwd: this.resolveCwd(options.cwd),
        env,
        shell: process.platform === "win32",
        windowsHide: true,
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let settled = false;
      const finish = (result: CommandResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        options.signal?.removeEventListener("abort", abort);
        resolve(result);
      };
      const abort = (): void => {
        this.logger.verbose("nuget.cli", `${safeCommand} aborted`);
        child.kill();
        finish({ code: -1, stdout: "", stderr: "aborted" });
      };
      options.signal?.addEventListener("abort", abort, { once: true });

      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.on("error", (error) => {
        this.logger.error(
          "nuget.cli",
          `${safeCommand} failed: ${error.message}`,
        );

        finish({ code: -1, stdout: "", stderr: error.message });
      });
      child.on("close", (code) => {
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
    });
  }

  private resolveCwd(fallback: string | undefined): string | undefined {
    const cwd = this.settings.workspacePath ?? fallback;
    if (!cwd) {
      return undefined;
    }

    return process.platform === "win32" ? sanitizeWindowsCwd(cwd) : cwd;
  }
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
