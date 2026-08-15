import path from "node:path";
import { window, workspace, type Memento } from "vscode";
import type { WorkspaceTarget } from "#contracts";

const storageKey = "nuget-code.activeSolution";

interface SolutionQuickPickItem {
  label: string;
  description: string;
  targetId: string;
  solutionPath: string;
}

export class SolutionSelector {
  constructor(private readonly workspaceState: Memento) {}

  async resolve(solutions: WorkspaceTarget[]): Promise<string> {
    if (solutions.length === 0) return "";
    if (solutions.length === 1) return solutions[0]?.id ?? "";

    const stored = this.workspaceState.get<string>(storageKey);
    if (stored) {
      const match = solutions.find((t) => t.path === stored);
      if (match) return match.id;
      await this.clear();
    }

    return this.prompt(solutions);
  }

  async prompt(solutions: WorkspaceTarget[]): Promise<string> {
    const items = buildQuickPickItems(solutions);
    const picked = await window.showQuickPick(items, {
      title: "NuGet: Select Active Solution",
      placeHolder: "Choose which solution to use for NuGet operations",
      ignoreFocusOut: true,
    });
    if (!picked) return solutions[0]?.id ?? "";
    await this.persist(picked.solutionPath);
    return picked.targetId;
  }

  async persist(solutionPath: string): Promise<void> {
    await this.workspaceState.update(storageKey, solutionPath);
  }

  async clear(): Promise<void> {
    await this.workspaceState.update(storageKey, undefined);
  }
}

function buildQuickPickItems(
  solutions: WorkspaceTarget[],
): SolutionQuickPickItem[] {
  const basenames = solutions.map((t) => path.basename(t.path));
  const isDuplicate = (basename: string) =>
    basenames.filter((n) => n === basename).length > 1;

  return solutions.map((t) => {
    const relativePath = workspace.asRelativePath(t.path, true);
    const basename = path.basename(t.path);
    return {
      label: isDuplicate(basename) ? relativePath : t.name,
      description: relativePath,
      targetId: t.id,
      solutionPath: t.path,
    };
  });
}
