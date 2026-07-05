import { beforeEach, describe, expect, it, vi } from "vitest";
import { SolutionSelector } from "./solution-selector.js";
import type { WorkspaceTarget } from "#contracts";
import { window, workspace, __resetVscodeMock } from "./test/vscode.js";

describe("SolutionSelector", () => {
  beforeEach(() => {
    __resetVscodeMock();
  });

  function memento(stored?: string) {
    return {
      get: vi.fn((_key: string, fallback?: unknown) => stored ?? fallback),
      update: vi.fn().mockResolvedValue(undefined),
      keys: vi.fn().mockReturnValue([]),
      setKeysForSync: vi.fn(),
    };
  }

  function solution(name: string, solutionPath: string): WorkspaceTarget {
    return {
      id: `solution:${solutionPath}`,
      kind: "solution",
      name,
      path: solutionPath,
      projectPaths: [],
    };
  }

  describe("resolve", () => {
    it("returns empty string when no solutions", async () => {
      const selector = new SolutionSelector(memento());
      expect(await selector.resolve([])).toBe("");
    });

    it("returns only solution id without prompting", async () => {
      const selector = new SolutionSelector(memento());
      const sol = solution("App.sln", "/workspace/App.sln");
      expect(await selector.resolve([sol])).toBe(sol.id);
      expect(window.showQuickPick).not.toHaveBeenCalled();
    });

    it("returns stored solution id when stored path is still valid", async () => {
      const sol1 = solution("App.sln", "/workspace/App.sln");
      const sol2 = solution("Other.sln", "/workspace/Other.sln");
      const state = memento("/workspace/Other.sln");
      const selector = new SolutionSelector(state);

      expect(await selector.resolve([sol1, sol2])).toBe(sol2.id);
      expect(window.showQuickPick).not.toHaveBeenCalled();
    });

    it("clears stored path and prompts when stored solution no longer exists", async () => {
      const sol1 = solution("App.sln", "/workspace/App.sln");
      const sol2 = solution("Other.sln", "/workspace/Other.sln");
      const state = memento("/workspace/Deleted.sln");
      vi.mocked(window.showQuickPick).mockResolvedValue(undefined);
      const selector = new SolutionSelector(state);

      await selector.resolve([sol1, sol2]);

      expect(state.update).toHaveBeenCalledWith(
        "nuget-code.activeSolution",
        undefined,
      );
      expect(window.showQuickPick).toHaveBeenCalledOnce();
    });

    it("prompts when multiple solutions and nothing stored", async () => {
      const sol1 = solution("App.sln", "/workspace/App.sln");
      const sol2 = solution("Other.sln", "/workspace/Other.sln");
      vi.mocked(window.showQuickPick).mockResolvedValue(undefined);
      const selector = new SolutionSelector(memento());

      await selector.resolve([sol1, sol2]);

      expect(window.showQuickPick).toHaveBeenCalledOnce();
    });
  });

  describe("prompt", () => {
    it("returns first solution id when Quick Pick is cancelled", async () => {
      vi.mocked(window.showQuickPick).mockResolvedValue(undefined);
      const sol1 = solution("App.sln", "/workspace/App.sln");
      const sol2 = solution("Other.sln", "/workspace/Other.sln");
      const selector = new SolutionSelector(memento());

      expect(await selector.prompt([sol1, sol2])).toBe(sol1.id);
    });

    it("returns selected solution id and persists path", async () => {
      const sol1 = solution("App.sln", "/workspace/App.sln");
      const sol2 = solution("Other.sln", "/workspace/Other.sln");
      const state = memento();
      const selector = new SolutionSelector(state);

      vi.mocked(window.showQuickPick).mockResolvedValue({
        label: "Other.sln",
        description: "/workspace/Other.sln",
        targetId: sol2.id,
        solutionPath: sol2.path,
      } as never);

      expect(await selector.prompt([sol1, sol2])).toBe(sol2.id);
      expect(state.update).toHaveBeenCalledWith(
        "nuget-code.activeSolution",
        sol2.path,
      );
    });

    it("uses relative path as label when two solutions share the same filename", async () => {
      const sol1 = solution("App.sln", "/workspace/backend/App.sln");
      const sol2 = solution("App.sln", "/workspace/frontend/App.sln");
      vi.mocked(workspace.asRelativePath).mockImplementation((p: string) =>
        p.replace("/workspace/", ""),
      );
      vi.mocked(window.showQuickPick).mockResolvedValue(undefined);
      const selector = new SolutionSelector(memento());

      await selector.prompt([sol1, sol2]);

      const items = (vi.mocked(window.showQuickPick).mock
        .calls[0]?.[0] as Array<{
        label: string;
      }>)!;
      expect(items[0]?.label).toBe("backend/App.sln");
      expect(items[1]?.label).toBe("frontend/App.sln");
    });

    it("uses solution name as label when basenames are unique", async () => {
      const sol1 = solution("Backend.sln", "/workspace/backend/Backend.sln");
      const sol2 = solution("Frontend.sln", "/workspace/frontend/Frontend.sln");
      vi.mocked(window.showQuickPick).mockResolvedValue(undefined);
      const selector = new SolutionSelector(memento());

      await selector.prompt([sol1, sol2]);

      const items = (vi.mocked(window.showQuickPick).mock
        .calls[0]?.[0] as Array<{
        label: string;
      }>)!;
      expect(items[0]?.label).toBe("Backend.sln");
      expect(items[1]?.label).toBe("Frontend.sln");
    });
  });

  describe("persist and clear", () => {
    it("persists solution path to workspaceState", async () => {
      const state = memento();
      const selector = new SolutionSelector(state);
      await selector.persist("/workspace/App.sln");
      expect(state.update).toHaveBeenCalledWith(
        "nuget-code.activeSolution",
        "/workspace/App.sln",
      );
    });

    it("clears solution path from workspaceState", async () => {
      const state = memento("/workspace/App.sln");
      const selector = new SolutionSelector(state);
      await selector.clear();
      expect(state.update).toHaveBeenCalledWith(
        "nuget-code.activeSolution",
        undefined,
      );
    });
  });
});
