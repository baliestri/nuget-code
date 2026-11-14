/** The backend process ended while the request was waiting for its answer. */
export class BackendRestartedError extends Error {
  constructor() {
    super("The NuGet backend stopped before it answered.");
    this.name = "BackendRestartedError";
  }
}

/** There is no backend process to send the request to. */
export class BackendStoppedError extends Error {
  constructor() {
    super("The NuGet backend is not running.");
    this.name = "BackendStoppedError";
  }
}
