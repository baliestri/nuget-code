import { vi } from "vitest";

type ConfigSection = "nuget-code" | "http" | string;

const configurations = new Map<ConfigSection, Record<string, unknown>>();

export const ProgressLocation = {
  Notification: 15,
};

export const window = {
  showWarningMessage: vi.fn(),
  showInformationMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  withProgress: vi.fn(
    async (_options: unknown, task: () => Promise<unknown>) => await task(),
  ),
  createTerminal: vi.fn(),
};

export const workspace = {
  workspaceFile: undefined as { fsPath: string } | undefined,
  workspaceFolders: undefined as
    | Array<{ uri: { fsPath: string; toString: () => string } }>
    | undefined,
  findFiles: vi.fn(),
  getConfiguration: vi.fn((section: ConfigSection) => ({
    get: <T>(key: string, fallback: T): T =>
      (configurations.get(section)?.[key] as T | undefined) ?? fallback,
  })),
};

export function __setConfiguration(
  section: ConfigSection,
  values: Record<string, unknown>,
): void {
  configurations.set(section, values);
}

export function __resetVscodeMock(): void {
  configurations.clear();
  workspace.workspaceFile = undefined;
  workspace.workspaceFolders = undefined;
  workspace.findFiles.mockReset();
  workspace.getConfiguration.mockClear();
  window.showWarningMessage.mockReset();
  window.showInformationMessage.mockReset();
  window.showErrorMessage.mockReset();
  window.withProgress.mockReset();
  window.withProgress.mockImplementation(
    async (_options: unknown, task: () => Promise<unknown>) => await task(),
  );
  window.createTerminal.mockReset();
}

__resetVscodeMock();
