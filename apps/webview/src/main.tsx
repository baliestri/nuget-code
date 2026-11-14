import { BridgeClient, type Channel } from "@nuget-code/bridge";
import { createRoot } from "react-dom/client";
import { Root } from "./app/Root";

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

const channel: Channel = {
  post: (message) => vscode.postMessage(message),
  onMessage: (listener) => {
    const handler = (event: MessageEvent): void => listener(event.data);
    window.addEventListener("message", handler);
    return { dispose: () => window.removeEventListener("message", handler) };
  }
};

createRoot(document.getElementById("root")!).render(
  <Root
    client={new BridgeClient(channel)}
    storage={{ get: () => vscode.getState(), set: (state) => vscode.setState(state) }}
  />
);
