export interface PackageFeed {
  /** Non-secret packageSources attributes retained when editing inherited declarations. */
  sourceAttributes?: Record<string, string> | undefined;
  declaredUrl?: string;
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  sourceConfigId?: string | undefined;
  allowInsecure?: boolean | undefined;
  hasCredentials?: boolean | undefined;
}

export interface PackageFeedSummary {
  id: string;
  name: string;
  displayName: string;
  url: string;
  color: string;
}

export interface PackageVersionInfo {
  version: string;
  source: string;
  published?: string | undefined;
}

export interface NuGetPackageProjectState {
  projectPath: string;
  installedVersion?: string | undefined;
  implicit?: boolean | undefined;
}

export interface NuGetPackageDependency {
  id: string;
  versionRange: string;
}

export interface NuGetPackageDependencyGroup {
  framework: string;
  dependencies: NuGetPackageDependency[];
}

export interface NuGetPackageItem {
  projectUrl?: string | undefined;
  licenseUrl?: string | undefined;
  licenseExpression?: string | undefined;
  packageUrl?: string | undefined;
  totalDownloads?: number | undefined;
  frameworks?: string[] | undefined;
  localInstallations?: { version: string; path: string }[] | undefined;
  id: string;
  name: string;
  installedVersion?: string | undefined;
  availableVersion?: string | undefined;
  sourceName?: string | undefined;
  sourceUrl?: string | undefined;
  iconUrl?: string | undefined;
  description?: string | undefined;
  authors?: string | undefined;
  tags?: string[] | undefined;
  published?: string | undefined;
  projectPaths: string[];
  projectStates?: NuGetPackageProjectState[] | undefined;
  versions: PackageVersionInfo[];
  dependencyGroups: NuGetPackageDependencyGroup[];
  availableFeeds?: PackageFeedSummary[] | undefined;
  deprecated?: boolean | undefined;
  alternatePackage?: string | undefined;
  implicit?: boolean | undefined;
}

export interface NuGetConfigFile {
  mappingNames?: string[];
  revision?: string;
  sourceDirectives?: readonly {
    action: "add" | "remove" | "clear";
    key?: string;
  }[];
  disabledDirectives?: readonly {
    action: "add" | "remove" | "clear";
    key?: string;
    disabled?: boolean;
  }[];
  credentialNames?: readonly string[];
  id: string;
  name: string;
  path: string;
  origin: "effective" | "machine" | "user" | "workspace" | "unknown";
  hasCredentials: boolean;
  scope: string;
  feeds: PackageFeed[];
}

export interface SourceEdit {
  action: "upsert" | "remove";
  originalName?: string | undefined;
  name: string;
  url: string;
  enabled: boolean;
  allowInsecure: boolean;
}
export interface SourceDestination {
  id: string;
  path: string;
  label: string;
  revision: string;
  suggested?: boolean;
}
export interface SourceEditRequest {
  requestId: string;
  sourceId: string;
  sourceRevision: string;
  destinationId: string;
  destinationRevision: string;
  edit: SourceEdit;
}
export interface SourceEditorState {
  requestId?: string;
  destinations: SourceDestination[];
  status: "idle" | "loading" | "saving" | "saved" | "failed";
  message: string;
}

export interface NuGetCacheFolder {
  id: string;
  title: string;
  path: string;
  sizeBytes?: number | undefined;
  sizeCalculatedAt?: string | undefined;
  selected: boolean;
}
