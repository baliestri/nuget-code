/** How to start the backend: the published executable, or `dotnet` with the assembly during development. */
export interface BackendLaunch {
  command: string;
  args: readonly string[];
}

export interface Disposable {
  dispose(): void;
}
