export const RestoreEngines = {
  embedded: "embedded",
  msbuild: "msbuild",
  console: "console",
} as const

export type RestoreEngine = (typeof RestoreEngines)[keyof typeof RestoreEngines]

export const RestoreStates = {
  notRun: "notRun",
  succeeded: "succeeded",
  succeededWithWarnings: "succeededWithWarnings",
  failed: "failed",
  cancelled: "cancelled",
} as const

export type RestoreState = (typeof RestoreStates)[keyof typeof RestoreStates]

export const OperationSteps = {
  planning: "planning",
  editing: "editing",
  evaluating: "evaluating",
  restoring: "restoring",
  done: "done",
} as const

export type OperationStep = (typeof OperationSteps)[keyof typeof OperationSteps]

export const PackageChangeKinds = {
  install: "install",
  update: "update",
  remove: "remove",
} as const

export type PackageChangeKind = (typeof PackageChangeKinds)[keyof typeof PackageChangeKinds]

export const PlanWarningKinds = {
  centralShared: "centralShared",
  propertyShared: "propertyShared",
  importedShared: "importedShared",
  literalWrite: "literalWrite",
  downgrade: "downgrade",
  rangeReplaced: "rangeReplaced",
  centralRemoved: "centralRemoved",
  removeItem: "removeItem",
  frameworkMismatch: "frameworkMismatch",
} as const

export type PlanWarningKind = (typeof PlanWarningKinds)[keyof typeof PlanWarningKinds]

/** From the least to the most severe. */
export const LogLevels = {
  debug: "debug",
  verbose: "verbose",
  info: "info",
  warning: "warning",
  error: "error",
} as const

export type LogLevel = (typeof LogLevels)[keyof typeof LogLevels]

export const LogContexts = {
  backend: "VSCODE",
  nuget: "NUGET",
} as const

export type LogContext = (typeof LogContexts)[keyof typeof LogContexts]

export const ProgressKinds = {
  begin: "begin",
  report: "report",
  end: "end",
} as const

export type ProgressKind = (typeof ProgressKinds)[keyof typeof ProgressKinds]

export const FeedFailureKinds = {
  unreachable: "unreachable",
  authentication: "authentication",
} as const

export type FeedFailureKind = (typeof FeedFailureKinds)[keyof typeof FeedFailureKinds]

export const VersionOriginKinds = {
  project: "project",
  central: "central",
  versionOverride: "versionOverride",
  imported: "imported",
  undetermined: "undetermined",
} as const

export type VersionOriginKind = (typeof VersionOriginKinds)[keyof typeof VersionOriginKinds]

export const SolutionKinds = {
  sln: "sln",
  slnx: "slnx",
  slnf: "slnf",
  implicit: "implicit",
} as const

export type SolutionKind = (typeof SolutionKinds)[keyof typeof SolutionKinds]

/** The settings `sources/setProperty` accepts. */
export const SourceProperties = {
  globalPackagesFolder: "globalPackagesFolder",
  repositoryPath: "repositoryPath",
} as const

export type SourceProperty = (typeof SourceProperties)[keyof typeof SourceProperties]

/** Why a `restore/didFinish` notification was sent. */
export const RestoreReasons = {
  solutionOpen: "solutionOpen",
} as const

export type RestoreReason = (typeof RestoreReasons)[keyof typeof RestoreReasons]
