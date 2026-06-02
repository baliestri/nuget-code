import { Uri, commands, env, window } from "vscode";
import { NuGetClient } from "#client";
import type {
  ExtensionToWebviewMessage,
  PackageManagerOperationKind,
  PackageManagerState,
} from "#contracts";
import { PackageManagementCore } from "#manager";
import type { ExtensionLogger } from "#extension/logger";

interface FolderServiceOptions {
  getState: () => PackageManagerState;
  setState: (state: PackageManagerState) => void;
  logger: ExtensionLogger;
  publish: (message: ExtensionToWebviewMessage) => void;
  persistFolderSizeCache: (
    folders: PackageManagerState["folders"],
  ) => Promise<void>;
  runOperation: (
    kind: PackageManagerOperationKind,
    label: string,
    action: () => Promise<void>,
  ) => Promise<void>;
}

export class FolderService {
  constructor(private readonly options: FolderServiceOptions) {}

  async toggleFolder(folderId: string): Promise<void> {
    this.options.setState(
      PackageManagementCore.folders.toggleSingleFolderSelection(
        this.options.getState(),
        folderId,
      ),
    );
    await this.updateSelectedCacheFolderContext();
    this.options.publish({
      type: "foldersChanged",
      folders: this.options.getState().folders,
    });
  }

  async recalculateCacheSizes(): Promise<void> {
    await this.options.runOperation(
      "folders",
      "Recalculating NuGet cache sizes",
      async () => {
        this.options.setState({
          ...this.options.getState(),
          folders: await this.calculateFolderSizesWithProgress(),
        });

        await this.updateSelectedCacheFolderContext();
      },
    );
  }

  async calculateFolderSizesWithProgress(): Promise<
    PackageManagerState["folders"]
  > {
    await NuGetClient.calculateFolderSizes(
      this.options.getState().folders,
      this.options.logger,
      {
        onFolderSized: async (sizedFolder) => {
          const sizeCalculatedAt = new Date().toISOString();
          const state = this.options.getState();
          this.options.setState({
            ...state,
            folders: state.folders.map((folder) =>
              folder.id === sizedFolder.id
                ? {
                    ...folder,
                    sizeBytes: sizedFolder.sizeBytes,
                    sizeCalculatedAt,
                  }
                : folder,
            ),
          });

          await this.options.persistFolderSizeCache(
            this.options.getState().folders,
          );
          this.options.publish({
            type: "foldersChanged",
            folders: this.options.getState().folders,
          });
        },
      },
    );

    await this.options.persistFolderSizeCache(this.options.getState().folders);
    return this.options.getState().folders;
  }

  async openSelectedCacheFolder(): Promise<void> {
    const folder = this.options
      .getState()
      .folders.find((item) => item.selected);
    if (!folder) {
      window.showWarningMessage("Select a NuGet cache folder first.");
      return;
    }

    await env.openExternal(Uri.file(folder.path));
  }

  async clearSelectedCaches(): Promise<void> {
    const selected = this.options
      .getState()
      .folders.filter((folder) => folder.selected);
    if (selected.length === 0) {
      window.showWarningMessage(
        "Select one or more NuGet cache folders first.",
      );
      return;
    }

    const answer = await window.showWarningMessage(
      `Clear ${selected.length} selected NuGet cache folder(s)?`,
      { modal: true },
      "Clear caches",
    );

    if (answer !== "Clear caches") {
      return;
    }

    await this.options.runOperation(
      "clearCaches",
      "Clearing NuGet caches",
      async () => {
        await NuGetClient.clearCacheFolders(selected, this.options.logger);
        const state = this.options.getState();
        this.options.setState({
          ...state,
          folders: state.folders.map((folder) =>
            selected.some((item) => item.id === folder.id)
              ? {
                  ...folder,
                  sizeBytes: 0,
                  sizeCalculatedAt: new Date().toISOString(),
                  selected: false,
                }
              : folder,
          ),
        });

        await this.options.persistFolderSizeCache(
          this.options.getState().folders,
        );
        await this.updateSelectedCacheFolderContext();
        this.options.publish({
          type: "foldersChanged",
          folders: this.options.getState().folders,
        });
      },
    );
  }

  async updateSelectedCacheFolderContext(): Promise<void> {
    await commands.executeCommand(
      "setContext",
      "nuget-code.packageManager.hasSelectedCacheFolder",
      this.options.getState().folders.some((folder) => folder.selected),
    );
  }
}
