import { Methods } from "@nuget-code/protocol";
import type {
  ConfigurationParams,
  CredentialsRequestParams,
  CredentialsRequestResult,
  CredentialsResetParams,
  DidChangeFilesParams,
  FeedInfo,
  FolderSizeParams,
  FolderSizeResult,
  FoldersClearParams,
  FoldersClearResult,
  FoldersListResult,
  InitializeParams,
  InitializeResult,
  LogEntry,
  OperationProgressParams,
  OperationResult,
  PackageDetailsResult,
  PackagesDetailsParams,
  PackagesInstalledResult,
  PackagesInstallParams,
  PackagesPlanParams,
  PackagesPlanResult,
  PackagesRemoveParams,
  PackagesSearchParams,
  PackagesSearchResult,
  PackagesUpdateParams,
  PackagesUpdatesParams,
  PackagesUpdatesResult,
  ProgressParams,
  RestoreDidFinishParams,
  RestoreRunParams,
  SolutionDidChangeParams,
  SolutionOpenParams,
  SolutionOpenResult,
  SourceRemoveParams,
  SourceSetPropertyParams,
  SourcesListResult,
  SourceWriteParams
} from "@nuget-code/protocol";
import type { CancellationToken, MessageConnection } from "vscode-jsonrpc/node";
import { BackendStoppedError } from "./errors";
import type { Disposable } from "./launch";

export type CredentialsHandler = (params: CredentialsRequestParams) => Promise<CredentialsRequestResult>;

type Listener<T> = (value: T) => void;

class Emitter<T> {
  private readonly listeners = new Set<Listener<T>>();

  on(listener: Listener<T>): Disposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  fire(value: T): void {
    for (const listener of this.listeners) listener(value);
  }
}

interface Attachment {
  connection: MessageConnection;
  /** Rejects when the process behind the connection is lost. */
  lost: Promise<never>;
}

/**
 * The backend's methods, typed. It outlives any one process: listeners and the credentials handler are
 * registered here once and bound again to each connection that is attached.
 */
export class BackendApi {
  private readonly logEntry = new Emitter<LogEntry>();
  private readonly solutionDidChange = new Emitter<SolutionDidChangeParams>();
  private readonly progress = new Emitter<ProgressParams>();
  private readonly operationProgress = new Emitter<OperationProgressParams>();
  private readonly restoreDidFinish = new Emitter<RestoreDidFinishParams>();

  private attachment: Attachment | undefined;
  private credentialsHandler: CredentialsHandler | undefined;

  /**
   * Binds the API to the connection of a running process. `lost` is how a request in flight learns that
   * the process died: it rejects with the error the request should fail with.
   */
  attach(connection: MessageConnection, lost?: Promise<never>): void {
    connection.onNotification(Methods.logEntry, (entry: LogEntry) => this.logEntry.fire(entry));
    connection.onNotification(Methods.solutionDidChange, (params: SolutionDidChangeParams) =>
      this.solutionDidChange.fire(params)
    );
    connection.onNotification(Methods.progress, (params: ProgressParams) => this.progress.fire(params));
    connection.onNotification(Methods.operationProgress, (params: OperationProgressParams) =>
      this.operationProgress.fire(params)
    );
    connection.onNotification(Methods.restoreDidFinish, (params: RestoreDidFinishParams) =>
      this.restoreDidFinish.fire(params)
    );
    connection.onRequest(
      Methods.credentialsRequest,
      (params: CredentialsRequestParams): Promise<CredentialsRequestResult> =>
        this.credentialsHandler === undefined ? Promise.resolve({ cancelled: true }) : this.credentialsHandler(params)
    );

    const never = lost ?? new Promise<never>(() => {});
    // Nothing may be waiting on it when it rejects; that must not count as an unhandled rejection.
    never.catch(() => {});
    this.attachment = { connection, lost: never };
  }

  detach(): void {
    this.attachment = undefined;
  }

  // Notifications from the backend

  onLogEntry(listener: Listener<LogEntry>): Disposable {
    return this.logEntry.on(listener);
  }

  onSolutionDidChange(listener: Listener<SolutionDidChangeParams>): Disposable {
    return this.solutionDidChange.on(listener);
  }

  onProgress(listener: Listener<ProgressParams>): Disposable {
    return this.progress.on(listener);
  }

  onOperationProgress(listener: Listener<OperationProgressParams>): Disposable {
    return this.operationProgress.on(listener);
  }

  onRestoreDidFinish(listener: Listener<RestoreDidFinishParams>): Disposable {
    return this.restoreDidFinish.on(listener);
  }

  /** The one request the backend makes. Without a handler it is answered as cancelled. */
  onCredentialsRequest(handler: CredentialsHandler): void {
    this.credentialsHandler = handler;
  }

  // Lifecycle

  initialize(params: InitializeParams, token?: CancellationToken): Promise<InitializeResult> {
    return this.request(Methods.initialize, params, token);
  }

  async shutdown(token?: CancellationToken): Promise<void> {
    await this.request(Methods.shutdown, {}, token);
  }

  // Solution

  openSolution(params: SolutionOpenParams, token?: CancellationToken): Promise<SolutionOpenResult> {
    return this.request(Methods.solutionOpen, params, token);
  }

  async closeSolution(token?: CancellationToken): Promise<void> {
    await this.request(Methods.solutionClose, {}, token);
  }

  // Packages

  installedPackages(token?: CancellationToken): Promise<PackagesInstalledResult> {
    return this.request(Methods.packagesInstalled, {}, token);
  }

  packageUpdates(params: PackagesUpdatesParams, token?: CancellationToken): Promise<PackagesUpdatesResult> {
    return this.request(Methods.packagesUpdates, params, token);
  }

  searchPackages(params: PackagesSearchParams, token?: CancellationToken): Promise<PackagesSearchResult> {
    return this.request(Methods.packagesSearch, params, token);
  }

  packageDetails(params: PackagesDetailsParams, token?: CancellationToken): Promise<PackageDetailsResult> {
    return this.request(Methods.packagesDetails, params, token);
  }

  planPackages(params: PackagesPlanParams, token?: CancellationToken): Promise<PackagesPlanResult> {
    return this.request(Methods.packagesPlan, params, token);
  }

  installPackage(params: PackagesInstallParams, token?: CancellationToken): Promise<OperationResult> {
    return this.request(Methods.packagesInstall, params, token);
  }

  updatePackages(params: PackagesUpdateParams, token?: CancellationToken): Promise<OperationResult> {
    return this.request(Methods.packagesUpdate, params, token);
  }

  removePackage(params: PackagesRemoveParams, token?: CancellationToken): Promise<OperationResult> {
    return this.request(Methods.packagesRemove, params, token);
  }

  // Restore and operations

  restore(params: RestoreRunParams, token?: CancellationToken): Promise<OperationResult> {
    return this.request(Methods.restoreRun, params, token);
  }

  /** Cancels the operation that is running; that operation still answers, with `cancelled` states. */
  async cancelOperation(token?: CancellationToken): Promise<void> {
    await this.request(Methods.operationsCancel, {}, token);
  }

  // Sources

  listSources(token?: CancellationToken): Promise<SourcesListResult> {
    return this.request(Methods.sourcesList, {}, token);
  }

  addSource(params: SourceWriteParams, token?: CancellationToken): Promise<FeedInfo> {
    return this.request(Methods.sourcesAdd, params, token);
  }

  updateSource(params: SourceWriteParams, token?: CancellationToken): Promise<FeedInfo> {
    return this.request(Methods.sourcesUpdate, params, token);
  }

  async removeSource(params: SourceRemoveParams, token?: CancellationToken): Promise<void> {
    await this.request(Methods.sourcesRemove, params, token);
  }

  async setSourceProperty(params: SourceSetPropertyParams, token?: CancellationToken): Promise<void> {
    await this.request(Methods.sourcesSetProperty, params, token);
  }

  // Folders

  listFolders(token?: CancellationToken): Promise<FoldersListResult> {
    return this.request(Methods.foldersList, {}, token);
  }

  folderSize(params: FolderSizeParams, token?: CancellationToken): Promise<FolderSizeResult> {
    return this.request(Methods.foldersSize, params, token);
  }

  clearFolders(params: FoldersClearParams, token?: CancellationToken): Promise<FoldersClearResult> {
    return this.request(Methods.foldersClear, params, token);
  }

  // Notifications to the backend

  didChangeFiles(params: DidChangeFilesParams): Promise<void> {
    return this.notify(Methods.workspaceDidChangeFiles, params);
  }

  didChangeConfiguration(params: ConfigurationParams): Promise<void> {
    return this.notify(Methods.configurationDidChange, params);
  }

  resetCredentials(params: CredentialsResetParams): Promise<void> {
    return this.notify(Methods.credentialsReset, params);
  }

  private request<TResult>(method: string, params: object, token?: CancellationToken): Promise<TResult> {
    const attachment = this.attachment;
    if (attachment === undefined) {
      return Promise.reject(new BackendStoppedError());
    }

    // An explicit `undefined` token would be taken for a second parameter and the params sent as an array.
    const answer =
      token === undefined
        ? attachment.connection.sendRequest<TResult>(method, params)
        : attachment.connection.sendRequest<TResult>(method, params, token);
    // When the process is lost the race is settled by `lost`; the abandoned request must not be reported.
    answer.catch(() => {});
    return Promise.race([answer, attachment.lost]);
  }

  private notify(method: string, params: object): Promise<void> {
    const attachment = this.attachment;
    return attachment === undefined
      ? Promise.reject(new BackendStoppedError())
      : attachment.connection.sendNotification(method, params);
  }
}
