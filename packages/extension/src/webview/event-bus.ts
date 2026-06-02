import type { Disposable } from "vscode";
import { ExtensionToWebviewMessage } from "#contracts";

type PackageManagerEventListener = (message: ExtensionToWebviewMessage) => void;

export class PackageManagerEventBus implements Disposable {
  private readonly listeners = new Set<PackageManagerEventListener>();

  subscribe(listener: PackageManagerEventListener): Disposable {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  publish(message: ExtensionToWebviewMessage): void {
    for (const listener of this.listeners) {
      listener(message);
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
}
