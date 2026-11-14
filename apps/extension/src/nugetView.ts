import { randomBytes } from "node:crypto";
import { BridgeServer, type BridgeHandlers, type Channel } from "@nuget-code/bridge";
import * as vscode from "vscode";
import type { BackendSession } from "./backendSession";
import { toSessionState } from "./bridgeHost";
import { renderHtml } from "./webviewHtml";

export const VIEW_ID = "nuget.view";

/** The NuGet view in the panel: a web page with the interface, joined to the session by the bridge. */
export class NugetViewProvider implements vscode.WebviewViewProvider {
  /** Resolves when the page has loaded and said so. */
  readonly ready: Promise<void>;

  private markReady: () => void = () => {};

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly session: BackendSession,
    private readonly handlers: BridgeHandlers
  ) {
    this.ready = new Promise((resolve) => {
      this.markReady = resolve;
    });
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    const root = vscode.Uri.joinPath(this.extensionUri, "dist", "webview");
    const webview = view.webview;
    webview.options = { enableScripts: true, localResourceRoots: [root] };
    webview.html = renderHtml({
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(root, "main.js")).toString(),
      styleUri: webview.asWebviewUri(vscode.Uri.joinPath(root, "main.css")).toString(),
      cspSource: webview.cspSource,
      nonce: randomBytes(16).toString("base64")
    });

    const channel: Channel = {
      post: (message) => void webview.postMessage(message),
      onMessage: (listener) => webview.onDidReceiveMessage(listener)
    };
    const sendSession = (): void =>
      server.emit(
        "session",
        toSessionState({
          backend: this.session.state,
          solution: this.session.solution,
          opened: this.session.openedSolution,
          initialized: this.session.initializeResult
        })
      );
    const server = new BridgeServer(channel, this.handlers, () => {
      sendSession();
      this.markReady();
    });

    const api = this.session.api;
    const subscriptions = [
      server,
      this.session.onDidChange(sendSession),
      api.onSolutionDidChange((change) => server.emit("solutionDidChange", change)),
      api.onOperationProgress((progress) => server.emit("operationProgress", progress)),
      api.onRestoreDidFinish((finished) => server.emit("restoreDidFinish", finished)),
      api.onLogEntry((entry) => server.emit("logEntry", entry))
    ];
    view.onDidDispose(() => subscriptions.forEach((subscription) => subscription.dispose()));
  }
}
