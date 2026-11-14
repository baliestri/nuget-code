import { BackendApi } from "./backendApi";
import { BackendProcess, type BackendExit } from "./backendProcess";
import { Emitter, type Listener } from "./emitter";
import { BackendRestartedError } from "./errors";
import type { BackendLaunch, Disposable } from "./launch";
import { RestartPolicy } from "./restartPolicy";

export type BackendState = "starting" | "ready" | "stopped";

export interface BackendClientOptions {
  /** Called at every start: the binary to run may change between restarts. */
  launch: () => BackendLaunch;
  cwd: string;
  /** Runs after each start, the first one and every restart: where the host initializes the backend. */
  onStarted: (api: BackendApi) => Promise<void>;
  policy?: RestartPolicy;
  /** How long a process is given to exit when it is stopped on purpose. */
  graceMs?: number;
}

/**
 * Keeps one backend process running. A process that ends on its own is started again, within the limit of
 * the policy; requests that were waiting for it fail with `BackendRestartedError`.
 */
export class BackendClient {
  readonly api = new BackendApi();

  private readonly policy: RestartPolicy;
  private readonly graceMs: number;
  private readonly stateChanged = new Emitter<BackendState>();
  private readonly stderr = new Emitter<string>();
  /** Processes that were stopped on purpose: their exit is not a crash. */
  private readonly stopping = new WeakSet<BackendProcess>();
  private readonly failedToStart = new WeakMap<BackendProcess, Error>();

  private current: BackendProcess | undefined;
  private currentState: BackendState = "stopped";
  private disposed = false;

  constructor(private readonly options: BackendClientOptions) {
    this.policy = options.policy ?? new RestartPolicy();
    this.graceMs = options.graceMs ?? 2000;
  }

  get state(): BackendState {
    return this.currentState;
  }

  get pid(): number | undefined {
    return this.current?.pid;
  }

  onDidChangeState(listener: Listener<BackendState>): Disposable {
    return this.stateChanged.on(listener);
  }

  onStderr(listener: Listener<string>): Disposable {
    return this.stderr.on(listener);
  }

  /** Starts the backend. Rejects when the first start fails; the client is then stopped. */
  start(): Promise<void> {
    return this.launch();
  }

  /** Stops the process and starts a new one. Asked for, so it does not count as a crash. */
  async restart(): Promise<void> {
    this.policy.reset();
    await this.stopCurrent();
    if (!this.disposed) {
      await this.launch();
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.stopCurrent();
    this.setState("stopped");
  }

  private async launch(): Promise<void> {
    this.setState("starting");
    const backend = BackendProcess.start(this.options.launch(), this.options.cwd);
    this.current = backend;
    backend.onStderr((text) => this.stderr.fire(text));

    let lose: (error: Error) => void = () => {};
    const lost = new Promise<never>((_, reject) => {
      lose = reject;
    });
    this.api.attach(backend.connection, lost);
    void backend.exited.then((exit) => {
      lose(new BackendRestartedError());
      this.handleExit(backend, exit);
    });

    try {
      await this.options.onStarted(this.api);
    } catch (error) {
      const failure = this.failedToStart.get(backend);
      if (failure !== undefined) {
        throw failure;
      }

      if (this.current !== backend) {
        // The process died while it was being set up and a newer one has taken over.
        return;
      }

      await this.stopCurrent();
      this.setState("stopped");
      throw error;
    }

    if (this.current === backend) {
      this.setState("ready");
    }
  }

  private handleExit(backend: BackendProcess, exit: BackendExit): void {
    if (this.current !== backend || this.stopping.has(backend)) {
      return;
    }

    this.current = undefined;
    this.api.detach();
    backend.connection.dispose();
    if (exit.error !== undefined) {
      // The executable is missing or cannot be run: trying again would fail the same way.
      this.failedToStart.set(backend, exit.error);
      this.stderr.fire(`The backend could not be started: ${exit.error.message}\n`);
      this.setState("stopped");
      return;
    }

    if (this.disposed || !this.policy.recordCrash()) {
      this.setState("stopped");
      return;
    }

    // A failed restart leaves the client stopped; there is no caller to report it to.
    this.launch().catch(() => {});
  }

  private async stopCurrent(): Promise<void> {
    const backend = this.current;
    if (backend === undefined) {
      return;
    }

    this.stopping.add(backend);
    this.current = undefined;
    await backend.stop(this.graceMs);
    this.api.detach();
  }

  private setState(state: BackendState): void {
    if (this.currentState !== state) {
      this.currentState = state;
      this.stateChanged.fire(state);
    }
  }
}
