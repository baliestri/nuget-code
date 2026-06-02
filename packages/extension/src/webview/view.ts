import { WebviewToExtensionMessage } from "#contracts";
import { PackageManagerController } from "#extension/webview/controller";
import { getNonce } from "#extension/webview/nonce";
import {
  Uri,
  type Disposable,
  type ExtensionContext,
  type WebviewView,
  type WebviewViewProvider,
} from "vscode";

export class PackageManagerViewProvider
  implements WebviewViewProvider, Disposable
{
  constructor(
    private readonly context: ExtensionContext,
    private readonly controller: PackageManagerController,
  ) {}

  resolveWebviewView(view: WebviewView): void {
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [Uri.joinPath(this.context.extensionUri, "dist")],
    };
    view.webview.html = this.getHtml(view);
    view.webview.onDidReceiveMessage((message: WebviewToExtensionMessage) => {
      void this.controller.handleMessage(message);
    });
    this.controller.attach(view.webview);
  }

  dispose(): void {
    this.controller.dispose();
  }

  private getHtml(view: WebviewView): string {
    const nonce = getNonce();
    const scriptUri = view.webview
      .asWebviewUri(
        Uri.joinPath(this.context.extensionUri, "dist", "webview.js"),
      )
      .with({ query: `v=${nonce}` });
    const codiconFontUri = view.webview.asWebviewUri(
      Uri.joinPath(this.context.extensionUri, "dist", "assets", "codicon.ttf"),
    );
    const csp = [
      "default-src 'none'",
      `img-src ${view.webview.cspSource} https: data:`,
      `font-src ${view.webview.cspSource}`,
      `style-src ${view.webview.cspSource} 'unsafe-inline'`,
      `script-src ${view.webview.cspSource} 'nonce-${nonce}'`,
    ].join("; ");

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>NuGet Package Manager</title>
    <style>
      @font-face {
        font-family: codicon;
        src: url(${codiconFontUri});
      }
    </style>
  </head>
  <body>
    <div id="webview"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}
