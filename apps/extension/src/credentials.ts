import * as vscode from "vscode";
import { CredentialStore, type Credential, type CredentialPrompt } from "./credentialStore";

const INDEX = "nuget.credentialServers";

/** Asks for a user name and a password in two input boxes; the password is masked. */
const prompt: CredentialPrompt = {
  async ask(source: string, isRetry: boolean): Promise<Credential | undefined> {
    const title = `NuGet: sign in to ${source}`;
    const username = await vscode.window.showInputBox({
      title,
      prompt: isRetry ? "The feed refused the previous credentials. User name" : "User name",
      ignoreFocusOut: true
    });
    if (username === undefined) {
      return undefined;
    }

    const password = await vscode.window.showInputBox({
      title,
      prompt: "Password or access token",
      password: true,
      ignoreFocusOut: true
    });
    return password === undefined ? undefined : { username, password };
  }
};

/** The credential store over the editor's secret storage. The list of servers lives in the global state. */
export function createCredentialStore(context: vscode.ExtensionContext): CredentialStore {
  return new CredentialStore(
    context.secrets,
    {
      get: () => context.globalState.get<readonly string[]>(INDEX, []),
      set: (servers) => context.globalState.update(INDEX, servers)
    },
    prompt
  );
}
