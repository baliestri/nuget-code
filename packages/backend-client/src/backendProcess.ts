import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Methods } from "@nuget-code/protocol";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection
} from "vscode-jsonrpc/node";
import type { BackendLaunch, Disposable } from "./launch";

export interface BackendExit {
  code: number | null;
  signal: string | null;
  /** Set when the process could not be started at all. */
  error?: Error;
}

/** One backend process and the JSON-RPC connection over its stdin and stdout. */
export class BackendProcess {
  readonly connection: MessageConnection;
  readonly exited: Promise<BackendExit>;

  private readonly stderrListeners = new Set<(text: string) => void>();
  private hasExited = false;

  private constructor(private readonly child: ChildProcessWithoutNullStreams) {
    this.connection = createMessageConnection(
      new StreamMessageReader(child.stdout),
      new StreamMessageWriter(child.stdin)
    );
    // A dead process surfaces through `exited`; the stream errors that come with it are not news.
    this.connection.onError(() => {});
    child.stdin.on("error", () => {});

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (text: string) => {
      for (const listener of this.stderrListeners) listener(text);
    });

    this.exited = new Promise((resolve) => {
      child.once("error", (error) => {
        this.hasExited = true;
        resolve({ code: null, signal: null, error });
      });
      child.once("exit", (code, signal) => {
        this.hasExited = true;
        resolve({ code, signal });
      });
    });
    this.connection.listen();
  }

  static start(launch: BackendLaunch, cwd: string, env?: Record<string, string>): BackendProcess {
    const child = spawn(launch.command, [...launch.args], {
      cwd,
      env: { ...process.env, ...env },
      stdio: "pipe",
      windowsHide: true
    });
    return new BackendProcess(child);
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  onStderr(listener: (text: string) => void): Disposable {
    this.stderrListeners.add(listener);
    return { dispose: () => this.stderrListeners.delete(listener) };
  }

  /** Ends the process without asking: what a crash looks like from the outside. */
  kill(): void {
    this.child.kill();
  }

  /**
   * Asks the backend to stop its own child processes, closes its input, which is what makes it exit, and
   * kills it if it is still there after `graceMs`.
   */
  async stop(graceMs: number): Promise<void> {
    if (this.hasExited) {
      this.connection.dispose();
      return;
    }

    const deadline = delay(graceMs);
    try {
      await Promise.race([this.connection.sendRequest(Methods.shutdown, {}), deadline.promise, this.exited]);
    } catch {
      // The process may already be on its way out; closing the input below is what matters.
    }

    this.child.stdin.end();
    await Promise.race([this.exited, deadline.promise]);
    deadline.cancel();
    if (!this.hasExited) {
      this.child.kill();
      await this.exited;
    }

    this.connection.dispose();
  }
}

function delay(ms: number): { promise: Promise<void>; cancel(): void } {
  let timer: NodeJS.Timeout | undefined;
  const promise = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return { promise, cancel: () => clearTimeout(timer) };
}
