import type { ProjectInfo } from "@nuget-code/protocol";
import { shownVersion, type PackageRow, type TransitiveRow } from "./model";

/** What the details panel offers for one project. */
export interface ProjectAction {
  path: string;
  name: string;
  /** The version the project has; absent when it does not reference the package. */
  installed?: string;
  /** The project has the package without referencing it: in which version, and with which of its packages. */
  transitive?: { version: string; via: readonly string[] };
  canInstall: boolean;
  /** The project has the package in another version than the selected one. */
  canUpdate: boolean;
  canRemove: boolean;
}

const sameText = (left: string, right: string): boolean => left.toLowerCase() === right.toLowerCase();

/**
 * For each project of the target: install when it does not reference the package, update and remove when it
 * does. A project that only has the package through another one can install it, which makes it a reference
 * of its own; there is no declaration to update or remove. A package the SDK adds on its own has no
 * declaration to change either, so it offers nothing. `version` is the one selected in the panel; without
 * one, nothing can be installed or updated, but removing still works.
 *
 * The projects that reference the package come first, then the ones that have it through another, then the
 * rest, each group in the order of the solution.
 */
export function projectActions(
  row: PackageRow | undefined,
  projects: readonly ProjectInfo[],
  version: string | undefined,
  transitive?: TransitiveRow
): ProjectAction[] {
  const actions = projects.map((project): ProjectAction => {
    const use = row?.projects.find((item) => sameText(item.path, project.path));
    const base = { path: project.path, name: project.name };
    if (use === undefined) {
      const through = transitive?.projects.find((item) => sameText(item.path, project.path));
      return {
        ...base,
        ...(through === undefined ? {} : { transitive: { version: through.version, via: through.via } }),
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
  const rank = (action: ProjectAction): number => {
    if (row?.projects.some((item) => sameText(item.path, action.path)) === true) {
      return 0;
    }

    return action.transitive === undefined ? 2 : 1;
  };
  return [0, 1, 2].flatMap((wanted) => actions.filter((action) => rank(action) === wanted));
}
