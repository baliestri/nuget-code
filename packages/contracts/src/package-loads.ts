export type ReadFlow = "inventory" | "search" | "catalog" | "details";
export interface LoadState {
  status: "idle" | "loading" | "ready" | "failed";
  stale: boolean;
  error: string | null;
}
export interface StateRevision {
  sessionId: string;
  revision: number;
}
export interface DeltaRevision extends StateRevision {
  baseRevision: number;
}
