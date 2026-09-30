import type { PackageManagerState } from "#contracts";
export function packageStatus(state: PackageManagerState): {
  text: string;
  tooltip: string;
} {
  const candidates =
    state.updates.context.targetId === state.selectedTargetId
      ? state.updates.evaluation.candidates
      : [];
  const ready = candidates.filter(
    (candidate) => candidate.compatibility.status === "compatible",
  ).length;
  const checking = candidates.filter(
    (candidate) =>
      candidate.compatibility.status === "unverified" &&
      candidate.compatibility.reason === "compatibility-not-verified",
  ).length;
  const unverified = candidates.length - ready - checking;
  const flows = [
    state.flows.inventory,
    state.flows.catalog,
    state.flows.search,
  ];
  const errors = [
    ...new Set(
      flows
        .filter((flow) => flow.status === "failed")
        .map((flow) => flow.error ?? "Could not load package data."),
    ),
  ];
  const loading =
    flows.some((flow) => flow.status === "loading") || checking > 0;
  const icon = errors.length
    ? "$(warning)"
    : loading
      ? "$(sync~spin)"
      : "$(package)";
  return {
    text: `${icon} NuGet: ${ready} ready${checking ? ` · ${checking} checking` : ""}${unverified ? ` · ${unverified} unverified` : ""}${loading && !checking ? " · loading" : ""}`,
    tooltip: [
      "NuGet package status",
      ...errors,
      ...(flows.some((flow) => flow.stale)
        ? ["Showing previous data while it is revalidated."]
        : []),
      `${ready} verified project updates; ${checking} checks pending; ${unverified} candidates without applicable verification.`,
      "Click to retry / refresh NuGet data.",
    ].join("\n"),
  };
}
