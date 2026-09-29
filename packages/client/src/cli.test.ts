import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NuGetCli } from "./cli";

describe("CLI process execution", () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "nuget-cli-"));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  function cli(executable = process.execPath) {
    return new NuGetCli(
      {
        dotnetPath: executable,
        nugetPath: executable,
        workspacePath: root,
        credentialProviderPaths: [],
        extraConfigPaths: [],
        proxy: "",
        maxSearchResults: 100,
      },
      {
        error: vi.fn(),
        warning: vi.fn(),
        information: vi.fn(),
        verbose: vi.fn(),
      },
    );
  }

  it("honors explicit cwd and passes metacharacters literally without a shell", async () => {
    const project = path.join(root, "App & Tests");
    await fs.mkdir(project);
    const script = path.join(project, "print args.cjs");
    await fs.writeFile(
      script,
      "process.stdout.write(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2)}))",
    );
    const args = [
      "Demo & Echo",
      "$(whoami)",
      "%PATH%",
      "with spaces",
      'quote"inside',
    ];
    const result = await cli().runDotnet([script, ...args], project);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ cwd: project, args });
  });

  it("uses workspace cwd only when there is no explicit directory", async () => {
    const script = path.join(root, "cwd.cjs");
    await fs.writeFile(script, "process.stdout.write(process.cwd())");
    expect((await cli().runDotnet([script])).stdout).toBe(root);
  });

  it("reports executable launch failures separately from command exit status", async () => {
    const result = await cli(path.join(root, "missing-executable")).runDotnet(
      [],
    );
    expect(result).toMatchObject({
      code: -1,
      failure: { kind: "launch", code: "ENOENT" },
    });
  });

  it("reports synchronous process launch errors through the same result type", async () => {
    await expect(cli().runDotnet(["\0"])).resolves.toMatchObject({
      code: -1,
      failure: { kind: "launch", code: "ERR_INVALID_ARG_VALUE" },
    });
  });

  it("rejects an already-cancelled read without running the command", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      cli().runDotnet([], root, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("cancels an active process and waits for it to close", async () => {
    const script = path.join(root, "wait.cjs");
    await fs.writeFile(script, "setInterval(() => {}, 1000)");
    await expect(
      cli().runDotnet([script], root, { signal: AbortSignal.timeout(100) }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("preserves nonzero exit codes and captured diagnostics", async () => {
    const script = path.join(root, "failure.cjs");
    await fs.writeFile(
      script,
      "process.stderr.write('failed'); process.exitCode=7",
    );
    expect(await cli().runDotnet([script])).toEqual({
      code: 7,
      stdout: "",
      stderr: "failed",
    });
  });
});
