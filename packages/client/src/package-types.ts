import type { NuGetPackageItem } from "#contracts/nuget";

export interface PackageSnapshot {
  installed: NuGetPackageItem[];
  implicit: NuGetPackageItem[];
  available: NuGetPackageItem[];
}

export interface PackageInventory {
  installed: NuGetPackageItem[];
  implicit: NuGetPackageItem[];
}

export interface DotnetPackageList {
  projects?: DotnetListedProject[];
}

export interface DotnetListedProject {
  path: string;
  frameworks?: DotnetListedFramework[];
}

export interface DotnetListedFramework {
  framework: string;
  topLevelPackages?: DotnetListedPackage[];
  transitivePackages?: DotnetListedPackage[];
}

export interface DotnetListedPackage {
  id: string;
  requestedVersion?: string;
  resolvedVersion?: string;
  latestVersion?: string;
}

export interface ServiceIndex {
  resources?: ServiceResource[];
}

export interface ServiceResource {
  "@id"?: string;
  "@type"?: string;
}

export interface SearchResponse {
  data?: SearchPackage[];
}

export interface SearchPackage {
  id: string;
  version?: string;
  description?: string;
  iconUrl?: string;
  authors?: string[] | string;
  tags?: string[];
  published?: string;
  versions?: Array<{
    version: string;
  }>;
}

export interface RegistrationIndex {
  items?: RegistrationPage[];
}

export interface RegistrationPage {
  "@id"?: string;
  items?: RegistrationLeaf[];
}

export interface RegistrationLeaf {
  catalogEntry: RegistrationCatalogEntry;
}

export interface RegistrationCatalogEntry {
  id?: string;
  version: string;
  description?: string;
  iconUrl?: string;
  authors?: string[] | string;
  tags?: string[] | string;
  published?: string;
  dependencyGroups?: RegistrationDependencyGroup[];
  deprecation?: {
    alternatePackage?: {
      id?: string;
    };
  };
}

export interface RegistrationDependencyGroup {
  targetFramework?: string;
  dependencies?: RegistrationDependency[];
}

export interface RegistrationDependency {
  id: string;
  range?: string;
}
