/*
 * One interface per record of the backend's `Protocol/` folder, with the same name.
 * A property the backend declares nullable is optional here, because the backend omits null values.
 */

import type {
  FeedFailureKind,
  LogContext,
  LogLevel,
  OperationStep,
  PackageChangeKind,
  PlanWarningKind,
  ProgressKind,
  RestoreEngine,
  RestoreReason,
  RestoreState,
  SolutionKind,
  SourceProperty,
  VersionOriginKind
} from "./constants";

/** The params or result of a method that carries none. */
export type Empty = Record<string, never>;

// Lifecycle

export interface InitializeParams {
  dotnetPath?: string;
  feedTimeoutSeconds?: number;
  restoreEngine?: RestoreEngine;
  restoreOnOpen?: boolean;
}

export interface SdkInfo {
  dotnetPath: string;
  version: string;
}

export interface InitializeResult {
  protocolVersion: number;
  backendVersion: string;
  sdk?: SdkInfo;
}

export interface ConfigurationParams {
  restoreEngine?: RestoreEngine;
  restoreOnOpen?: boolean;
}

// Solution

export interface SolutionOpenParams {
  path: string;
  projects?: readonly string[];
}

export interface ProjectInfo {
  name: string;
  path: string;
  frameworks: readonly string[];
  centralPackageManagement: boolean;
  error?: string;
}

export interface SolutionOpenResult {
  path: string;
  kind: SolutionKind;
  projects: readonly ProjectInfo[];
}

export interface SolutionDidChangeParams {
  projects: readonly string[];
}

export interface DidChangeFilesParams {
  paths: readonly string[];
}

// Installed packages

export interface VersionOrigin {
  kind: VersionOriginKind;
  file?: string;
  line?: number;
  column?: number;
}

export interface InstalledPackage {
  id: string;
  requestedVersion?: string;
  resolvedVersion?: string;
  frameworks: readonly string[];
  implicit: boolean;
  restored: boolean;
  origin?: VersionOrigin;
}

/** A package a project has without referencing it. */
export interface TransitivePackage {
  id: string;
  resolvedVersion: string;
  frameworks: readonly string[];
  /** The packages the project references through which this one arrives; none when it comes with a project. */
  via: readonly string[];
}

export interface ProjectPackages {
  projectPath: string;
  packages: readonly InstalledPackage[];
  /** Empty until the project is restored. */
  transitive: readonly TransitivePackage[];
}

export interface PackagesInstalledResult {
  projects: readonly ProjectPackages[];
}

// Feeds

export interface FeedFailure {
  feed: string;
  kind: FeedFailureKind;
  message: string;
}

export interface FeedVersion {
  feed: string;
  version: string;
}

export interface PackageLatest {
  id: string;
  versions: readonly FeedVersion[];
}

export interface PackagesUpdatesParams {
  prerelease: boolean;
  noCache: boolean;
  progressToken?: string;
  /** Answer about the transitive packages and not about the referenced ones. Defaults to false. */
  transitive?: boolean;
}

export interface PackagesUpdatesResult {
  packages: readonly PackageLatest[];
  failures: readonly FeedFailure[];
}

export interface ProgressParams {
  token: string;
  kind: ProgressKind;
  package?: PackageLatest;
}

export interface PackagesSearchParams {
  query?: string;
  feed?: string;
  prerelease: boolean;
  skip: number;
  take: number;
}

export interface PackageSummary {
  id: string;
  version: string;
  description?: string;
  authors?: string;
  iconUrl?: string;
  downloadCount?: number;
  feed: string;
}

export interface PackagesSearchResult {
  packages: readonly PackageSummary[];
  failures: readonly FeedFailure[];
}

export interface PackagesDetailsParams {
  id: string;
  feed?: string;
  prerelease: boolean;
  noCache: boolean;
}

export interface DependencyInfo {
  id: string;
  range: string;
}

export interface DependencyGroupInfo {
  framework: string;
  dependencies: readonly DependencyInfo[];
}

export interface PackageDetailsResult {
  id: string;
  versions: readonly string[];
  description?: string;
  authors?: string;
  license?: string;
  licenseUrl?: string;
  projectUrl?: string;
  iconUrl?: string;
  dependencyGroups: readonly DependencyGroupInfo[];
  feed?: string;
  failures: readonly FeedFailure[];
}

// Package changes

export interface PackageChangeParams {
  kind: PackageChangeKind;
  id: string;
  version?: string;
  projects: readonly string[];
}

export interface PackagesPlanParams {
  changes: readonly PackageChangeParams[];
}

export interface PlannedEditInfo {
  file: string;
  line: number;
  oldText: string;
  newText: string;
}

export interface PlanWarningInfo {
  kind: PlanWarningKind;
  packageId: string;
  file?: string;
  projects: readonly string[];
  packages: readonly string[];
  detail?: string;
}

export interface PackagesPlanResult {
  edits: readonly PlannedEditInfo[];
  warnings: readonly PlanWarningInfo[];
}

export interface PackagesInstallParams {
  id: string;
  version: string;
  projects: readonly string[];
}

export interface PackagesUpdateParams {
  changes: readonly PackageChangeParams[];
}

export interface PackagesRemoveParams {
  id: string;
  projects: readonly string[];
}

export interface OperationProgressParams {
  step: OperationStep;
  project?: string;
}

// Operations and restore

export interface RestoreMessageInfo {
  level: LogLevel;
  code?: string;
  message: string;
}

export interface ProjectOperationResult {
  project: string;
  changedFiles: readonly string[];
  editErrors: readonly string[];
  restore: RestoreState;
  messages: readonly RestoreMessageInfo[];
}

export interface OperationResult {
  engine?: RestoreEngine;
  fellBack: boolean;
  projects: readonly ProjectOperationResult[];
}

export interface RestoreRunParams {
  projects?: readonly string[];
  engine?: RestoreEngine;
  force: boolean;
}

export interface RestoreDidFinishParams {
  reason: RestoreReason;
  result: OperationResult;
}

// Sources

export interface FeedInfo {
  name: string;
  source: string;
  enabled: boolean;
  allowInsecureConnections: boolean;
  protocolVersion: number;
  isLocal: boolean;
  disableTlsCertificateValidation: boolean;
  isMachineWide: boolean;
  declaredIn?: string;
}

export interface ConfigFileInfo {
  path: string;
  feeds: readonly FeedInfo[];
  writable: boolean;
  isMachineWide: boolean;
  globalPackagesFolder?: string;
  repositoryPath?: string;
}

export interface SourcesListResult {
  files: readonly ConfigFileInfo[];
  effective: readonly FeedInfo[];
  fallbackFolders: readonly string[];
  globalPackagesFolder: string;
  localPackagesFolder?: string;
}

export interface SourceWriteParams {
  file?: string;
  name: string;
  newName?: string;
  source?: string;
  enabled?: boolean;
  allowInsecureConnections?: boolean;
  disableTlsCertificateValidation?: boolean;
}

export interface SourceRemoveParams {
  file?: string;
  name: string;
}

export interface SourceSetPropertyParams {
  file: string;
  property: SourceProperty;
  value?: string;
}

// Folders

export interface FolderInfo {
  title: string;
  path: string;
  clearable: boolean;
}

export interface FoldersListResult {
  folders: readonly FolderInfo[];
}

export interface FolderSizeParams {
  path: string;
}

export interface FolderSizeResult {
  exists: boolean;
  bytes: number;
}

export interface FoldersClearParams {
  paths: readonly string[];
}

export interface FolderClearInfo {
  path: string;
  bytesFreed: number;
  skipped: readonly string[];
}

export interface FoldersClearResult {
  folders: readonly FolderClearInfo[];
}

// Log

export interface LogEntry {
  level: LogLevel;
  /** ISO 8601, with offset. */
  time: string;
  context: LogContext;
  message: string;
}

// Credentials

export interface CredentialsRequestParams {
  source: string;
  isRetry: boolean;
}

export interface CredentialsRequestResult {
  username?: string;
  password?: string;
  cancelled: boolean;
}

export interface CredentialsResetParams {
  source?: string;
}
