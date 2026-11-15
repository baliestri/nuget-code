import { PlanWarningKinds, type PlanWarningInfo } from "@nuget-code/protocol";

function fileName(path: string | undefined): string {
  return path === undefined ? "a shared file" : (path.split(/[\\/]/).at(-1) ?? path);
}

function projectName(path: string): string {
  return (path.split(/[\\/]/).at(-1) ?? path).replace(/\.[^.]+$/, "");
}

function list(items: readonly string[]): string {
  return items.length <= 3 ? items.join(", ") : `${items.slice(0, 3).join(", ")} and ${items.length - 3} more`;
}

/** One sentence that says what a change did beyond what was asked, naming what it touched. */
export function describeWarning(warning: PlanWarningInfo): string {
  const id = warning.packageId;
  const file = fileName(warning.file);
  const projects = list(warning.projects.map(projectName));
  switch (warning.kind) {
    case PlanWarningKinds.centralShared:
      return `${id}: the version in ${file} is shared, so it changed for ${projects}.`;
    case PlanWarningKinds.importedShared:
      return `${id}: the version is declared in ${file}, so it changed for ${projects}.`;
    case PlanWarningKinds.propertyShared:
      return `${id}: its version comes from the property ${warning.detail ?? ""} in ${file}, which ${list(warning.packages)} also use.`;
    case PlanWarningKinds.literalWrite:
      return `${id}: the version was the expression ${warning.detail ?? ""} in ${file}; it was replaced by the version itself.`;
    case PlanWarningKinds.rangeReplaced:
      return `${id}: the version was ${warning.detail ?? "a range"} in ${file}; it was replaced by one version.`;
    case PlanWarningKinds.downgrade:
      return `${id}: this is a downgrade from ${warning.detail ?? "a newer version"}.`;
    case PlanWarningKinds.centralRemoved:
      return `${id}: no other project uses it, so its version was removed from ${file} too.`;
    case PlanWarningKinds.removeItem:
      return `${id}: it is declared in an imported file, so ${file} now opts out of it instead.`;
    case PlanWarningKinds.frameworkMismatch:
      return `${id}: this version lists no framework compatible with ${warning.detail ?? "the target framework"} of ${projects}.`;
    default:
      return `${id}: ${warning.kind}${warning.detail === undefined ? "" : ` (${warning.detail})`}.`;
  }
}
