import { RestoreStates, type OperationResult } from "@nuget-code/protocol";

export interface RestoreSummary {
  kind: "succeeded" | "failed" | "cancelled";
  failed: number;
  total: number;
}

/** How a restore went as a whole. A failure outweighs a cancellation; warnings still count as success. */
export function summarizeRestore(result: OperationResult): RestoreSummary {
  const total = result.projects.length;
  const failed = result.projects.filter((project) => project.restore === RestoreStates.failed).length;
  if (failed > 0) {
    return { kind: "failed", failed, total };
  }

  const cancelled = result.projects.some((project) => project.restore === RestoreStates.cancelled);
  return { kind: cancelled ? "cancelled" : "succeeded", failed: 0, total };
}
