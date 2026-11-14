import type { ProjectInfo } from "@nuget-code/protocol";
import { shownVersion, type PackageRow } from "./model";

/** What the details panel offers for one project. */
export interface ProjectAction {
  path: string;
  name: string;
  /** The version the project has; absent when it does not reference the package. */
  installed?: string;
  canInstall: boolean;
  /** The project has the package in another version than the selected one. */
  canUpdate: boolean;
  canRemove: boolean;
}

const sameText = (left: string, right: string): boolean => left.toLowerCase() === right.toLowerCase();

/**
 * For each project of the target: install when it does not have the package, update and remove when it
 * does. The projects that have the package come first, each group in the order of the solution. A package the SDK adds on its own has no declaration to change, so it offers nothing. `version` is
 * the one selected in the panel; without one, nothing can be installed or updated, but removing still works.
 */
export function projectActions(
  row: PackageRow | undefined,
  projects: readonly ProjectInfo[],
  version: string | undefined
): ProjectAction[] {
  const actions = projects.map((project): ProjectAction => {
    const use = row?.projects.find((item) => sameText(item.path, project.path));
    const base = { path: project.path, name: project.name };
    if (use === undefined) {
      return {
        ...base,
        canInstall: version !== undefined && project.error === undefined,
        canUpdate: false,
        canRemove: false
      };
    }

    const installed = shownVersion(use);
    return {
      ...base,
      ...(installed === undefined ? {} : { installed }),
      canInstall: false,
      canUpdate: !use.implicit && version !== undefined && installed !== version,
      canRemove: !use.implicit
    };
  });
  const has = (action: ProjectAction): boolean =>
    row?.projects.some((item) => sameText(item.path, action.path)) === true;
  return [...actions.filter(has), ...actions.filter((action) => !has(action))];
}
