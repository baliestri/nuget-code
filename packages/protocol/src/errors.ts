/** The error codes of the backend. Mirrors `Rpc/RpcErrorCodes.cs`. */
export const ErrorCodes = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  requestCancelled: -32800,

  sdkNotFound: 1001,
  solutionUnreadable: 1002,
  noSolutionOpen: 1003,
  evaluationFailed: 1004,
  feedUnreachable: 1005,
  authenticationRefused: 1006,

  projectNotInSession: 1101,
  packageNotInstalled: 1102,
  packageImplicit: 1103,
  editNotPossible: 1104,
  unknownRestoreEngine: 1105,
  configNotWritable: 1106,
  feedUnknown: 1107,
  feedDuplicate: 1108,
  folderNotClearable: 1109
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
