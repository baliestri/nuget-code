import type { SolutionTarget } from "./backendSession";

export interface WorkspaceFolderInfo {
  name: string;
  path: string;
}

/** Something the user can select: a solution file, or a folder that has projects and no solution file. */
export interface SolutionCandidate {
  /** The solution file, or the folder for an implicit solution. */
  path: string;
  kind: "solution" | "implicit";
  /** The workspace folder the candidate belongs to. */
  folder: string;
  label: string;
  description: string;
  /** The projects of an implicit solution. */
  projects?: readonly string[];
}

const IGNORED_SEGMENTS = new Set(["bin", "obj", "node_modules"]);

export interface CandidateInput {
  folders: readonly WorkspaceFolderInfo[];
  solutions: readonly string[];
  projects: readonly string[];
  /** `process.platform`: decides whether paths are compared ignoring case. */
  platform: string;
}

/**
 * The candidates of a workspace, folder by folder, then by path. A folder with solution files lists them; a
 * folder with projects and no solution file becomes one implicit solution. Build output and dependency
 * folders are not looked into.
 */
export function buildCandidates(input: CandidateInput): SolutionCandidate[] {
  const compare = comparer(input.platform);
  const folders = [...input.folders].sort((left, right) => compare(left.path, right.path));
  const candidates: SolutionCandidate[] = [];
  for (const folder of folders) {
    const owned = (paths: readonly string[]): string[] =>
      paths.filter((path) => !isIgnored(path) && ownerOf(path, input.folders, input.platform) === folder).sort(compare);
    const solutions = owned(input.solutions);
    for (const solution of solutions) {
      candidates.push({
        path: solution,
        kind: "solution",
        folder: folder.name,
        label: fileName(solution),
        description: relative(folder.path, solution)
      });
    }

    const projects = owned(input.projects);
    if (solutions.length === 0 && projects.length > 0) {
      candidates.push({
        path: folder.path,
        kind: "implicit",
        folder: folder.name,
        label: folder.name,
        description:
          projects.length === 1 ? "1 project, no solution file" : `${projects.length} projects, no solution file`,
        projects
      });
    }
  }

  return candidates;
}

/**
 * The solution to open without asking: the remembered one when it is still a candidate, else the only
 * candidate. With several candidates and nothing remembered, the user has to choose.
 */
export function chooseAutomatically(
  candidates: readonly SolutionCandidate[],
  remembered: string | undefined,
  platform: string
): SolutionCandidate | undefined {
  if (remembered !== undefined) {
    const known = candidates.find((candidate) => samePath(candidate.path, remembered, platform));
    if (known !== undefined) {
      return known;
    }
  }

  return candidates.length === 1 ? candidates[0] : undefined;
}

export function toTarget(candidate: SolutionCandidate): SolutionTarget {
  return candidate.projects === undefined
    ? { path: candidate.path }
    : { path: candidate.path, projects: candidate.projects };
}

export function samePath(left: string, right: string, platform: string): boolean {
  return ignoresCase(platform) ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function ignoresCase(platform: string): boolean {
  return platform === "win32" || platform === "darwin";
}

function comparer(platform: string): (left: string, right: string) => number {
  return ignoresCase(platform)
    ? (left, right) => compareOrdinal(left.toLowerCase(), right.toLowerCase())
    : compareOrdinal;
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function segments(path: string): string[] {
  return path.split(/[\\/]+/).filter((segment) => segment !== "");
}

function isIgnored(path: string): boolean {
  return segments(path)
    .slice(0, -1)
    .some((segment) => IGNORED_SEGMENTS.has(segment.toLowerCase()));
}

function fileName(path: string): string {
  return segments(path).at(-1) ?? path;
}

function isInside(folder: string, path: string, platform: string): boolean {
  const parent = segments(folder);
  const child = segments(path);
  return child.length > parent.length && parent.every((segment, index) => samePath(segment, child[index]!, platform));
}

/** The deepest workspace folder that contains the path, as the editor resolves it. */
function ownerOf(
  path: string,
  folders: readonly WorkspaceFolderInfo[],
  platform: string
): WorkspaceFolderInfo | undefined {
  return folders
    .filter((folder) => isInside(folder.path, path, platform))
    .sort((left, right) => segments(right.path).length - segments(left.path).length)[0];
}

function relative(folder: string, path: string): string {
  return segments(path).slice(segments(folder).length).join("/");
}
