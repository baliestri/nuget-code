import { vi, type Mock } from "vitest";

type ConfigSection = "nuget-code" | "http" | string;

const configurations = new Map<ConfigSection, Record<string, unknown>>();

export const ProgressLocation = {
  Notification: 15,
};

export const StatusBarAlignment = {
  Left: 1,
  Right: 2,
};

type WindowMock = {
  showWarningMessage: Mock;
  showInformationMessage: Mock;
  showErrorMessage: Mock;
  showQuickPick: Mock;
  withProgress: Mock;
  createTerminal: Mock;
  createStatusBarItem: Mock;
};

export const window: WindowMock = {
  showWarningMessage: vi.fn(),
  showInformationMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showQuickPick: vi.fn(),
  withProgress: vi.fn(
    async (_options: unknown, task: () => Promise<unknown>) => await task(),
  ),
  createTerminal: vi.fn(),
  createStatusBarItem: vi.fn(),
};

type FileSystemWatcherMock = {
  onDidCreate: Mock;
  onDidChange: Mock;
  onDidDelete: Mock;
  dispose: Mock;
};

function createFileSystemWatcherMock(): FileSystemWatcherMock {
  return {
    onDidCreate: vi.fn(),
    onDidChange: vi.fn(),
    onDidDelete: vi.fn(),
    dispose: vi.fn(),
  };
}

type WorkspaceMock = {
  workspaceFile: { fsPath: string } | undefined;
  workspaceFolders:
    | Array<{ uri: { fsPath: string; toString: () => string } }>
    | undefined;
  findFiles: Mock;
  asRelativePath: Mock;
  getConfiguration: Mock;
  createFileSystemWatcher: Mock;
};

export const workspace: WorkspaceMock = {
  workspaceFile: undefined,
  workspaceFolders: undefined,
  findFiles: vi.fn(),
  asRelativePath: vi.fn((pathOrUri: string) => pathOrUri),
  getConfiguration: vi.fn((section: ConfigSection) => ({
    get: <T>(key: string, fallback: T): T =>
      (configurations.get(section)?.[key] as T | undefined) ?? fallback,
  })),
  createFileSystemWatcher: vi.fn(() => createFileSystemWatcherMock()),
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
  workspace.asRelativePath.mockReset();
  workspace.asRelativePath.mockImplementation((pathOrUri: string) => pathOrUri);
  workspace.getConfiguration.mockClear();
  workspace.createFileSystemWatcher.mockReset();
  workspace.createFileSystemWatcher.mockImplementation(() =>
    createFileSystemWatcherMock(),
  );
  window.showWarningMessage.mockReset();
  window.showInformationMessage.mockReset();
  window.showErrorMessage.mockReset();
  window.showQuickPick.mockReset();
  window.withProgress.mockReset();
  window.withProgress.mockImplementation(
    async (_options: unknown, task: () => Promise<unknown>) => await task(),
  );
  window.createTerminal.mockReset();
  window.createStatusBarItem.mockReset();
  window.createStatusBarItem.mockImplementation(() => ({
    text: "",
    tooltip: "",
    command: undefined as string | undefined,
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  }));
}

__resetVscodeMock();
