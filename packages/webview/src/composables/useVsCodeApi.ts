import type { WebviewToExtensionMessage } from "#contracts";

interface VsCodeApi {
  postMessage(message: WebviewToExtensionMessage): void;
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi;
  }
}

const vscode = window.acquireVsCodeApi?.();

export function useVsCodeApi() {
  function postMessage(message: WebviewToExtensionMessage): void {
    vscode?.postMessage(message);
  }

  return { postMessage };
}
