export interface PackageFeed {
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
  id: string;
  name: string;
  path: string;
  origin: "effective" | "machine" | "user" | "workspace" | "unknown";
  hasCredentials: boolean;
  scope: string;
  feeds: PackageFeed[];
}

export interface NuGetCacheFolder {
  id: string;
  title: string;
  path: string;
  sizeBytes?: number | undefined;
  sizeCalculatedAt?: string | undefined;
  selected: boolean;
}
