/**
 * The JSON-RPC method names of the backend, requests and notifications alike.
 * Mirrors `Protocol/MethodNames.cs`; `drift.test.ts` fails when the two differ.
 */
export const Methods = {
  initialize: "initialize",
  shutdown: "shutdown",

  solutionOpen: "solution/open",
  solutionClose: "solution/close",
  solutionDidChange: "solution/didChange",

  packagesInstalled: "packages/installed",
  packagesUpdates: "packages/updates",
  packagesSearch: "packages/search",
  packagesDetails: "packages/details",
  packagesVulnerabilities: "packages/vulnerabilities",
  packagesPlan: "packages/plan",
  packagesInstall: "packages/install",
  packagesUpdate: "packages/update",
  packagesRemove: "packages/remove",
  operationProgress: "operation/progress",

  restoreRun: "restore/run",
  restoreDidFinish: "restore/didFinish",
  operationsCancel: "operations/cancel",
  configurationDidChange: "configuration/didChange",

  sourcesList: "sources/list",
  sourcesAdd: "sources/add",
  sourcesUpdate: "sources/update",
  sourcesRemove: "sources/remove",
  sourcesSetProperty: "sources/setProperty",

  foldersList: "folders/list",
  foldersSize: "folders/size",
  foldersClear: "folders/clear",

  workspaceDidChangeFiles: "workspace/didChangeFiles",

  logEntry: "log/entry",
  progress: "progress",

  credentialsRequest: "credentials/request",
  credentialsReset: "credentials/reset"
} as const;
