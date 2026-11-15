import type { CredentialsRequestParams, CredentialsRequestResult } from "@nuget-code/protocol";

const KEY_PREFIX = "nuget.credentials/";

/** The part of the editor's secret storage the store uses. */
export interface SecretStore {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}

/**
 * The servers that have a stored credential. Secret storage cannot be listed, so the addresses are kept
 * apart, and only the addresses.
 */
export interface IndexStore {
  get(): readonly string[];
  set(servers: readonly string[]): PromiseLike<void>;
}

export interface Credential {
  username: string;
  password: string;
}

export interface CredentialPrompt {
  /** Asks the user; `undefined` when they cancel. */
  ask(source: string, isRetry: boolean): Promise<Credential | undefined>;
}

/**
 * The server a credential belongs to: scheme, host and port, with the default port made explicit, so one
 * credential serves every URL of a feed. `undefined` for anything that is not an HTTP URL.
 */
export function serverOf(source: string): string | undefined {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return undefined;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return undefined;
  }

  const port = url.port === "" ? (url.protocol === "https:" ? "443" : "80") : url.port;
  return `${url.protocol}//${url.hostname}:${port}`;
}

/** Answers the backend's requests for credentials from secret storage, asking the user when it has to. */
export class CredentialStore {
  private readonly prompts = new Map<string, Promise<CredentialsRequestResult>>();

  constructor(
    private readonly secrets: SecretStore,
    private readonly index: IndexStore,
    private readonly prompt: CredentialPrompt
  ) {}

  async resolve(params: CredentialsRequestParams): Promise<CredentialsRequestResult> {
    const server = serverOf(params.source);
    if (server === undefined) {
      return { cancelled: true };
    }

    if (!params.isRetry) {
      const stored = parse(await this.secrets.get(KEY_PREFIX + server));
      if (stored !== undefined) {
        return { ...stored, cancelled: false };
      }
    }

    // Several requests for one server while the user is being asked share that one prompt.
    let pending = this.prompts.get(server);
    if (pending === undefined) {
      pending = this.ask(server, params).finally(() => this.prompts.delete(server));
      this.prompts.set(server, pending);
    }

    return pending;
  }

  /**
   * Stores a credential the user typed somewhere else than the prompt, such as the feed dialog. Returns
   * false, storing nothing, when the source is not an HTTP URL.
   */
  async save(source: string, credential: Credential): Promise<boolean> {
    const server = serverOf(source);
    if (server === undefined) {
      return false;
    }

    await this.remember(server, credential);
    return true;
  }

  /** Forgets every stored credential. */
  async clear(): Promise<void> {
    for (const server of this.index.get()) {
      await this.secrets.delete(KEY_PREFIX + server);
    }

    await this.index.set([]);
  }

  private async ask(server: string, params: CredentialsRequestParams): Promise<CredentialsRequestResult> {
    if (params.isRetry) {
      // The feed refused what was stored: it must not be offered again.
      await this.forget(server);
    }

    const answer = await this.prompt.ask(params.source, params.isRetry);
    if (answer === undefined) {
      return { cancelled: true };
    }

    await this.remember(server, answer);
    return { ...answer, cancelled: false };
  }

  private async remember(server: string, credential: Credential): Promise<void> {
    await this.secrets.store(
      KEY_PREFIX + server,
      JSON.stringify({ username: credential.username, password: credential.password })
    );
    if (!this.index.get().includes(server)) {
      await this.index.set([...this.index.get(), server]);
    }
  }

  private async forget(server: string): Promise<void> {
    await this.secrets.delete(KEY_PREFIX + server);
    await this.index.set(this.index.get().filter((known) => known !== server));
  }
}

function parse(stored: string | undefined): Credential | undefined {
  if (stored === undefined) {
    return undefined;
  }

  try {
    const value = JSON.parse(stored) as Partial<Credential>;
    return typeof value.username === "string" && typeof value.password === "string"
      ? { username: value.username, password: value.password }
      : undefined;
  } catch {
    return undefined;
  }
}
