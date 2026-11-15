import { describe, expect, it } from "vitest";
import { CredentialStore, serverOf, type Credential } from "./credentialStore";

const FEED = "https://nuget.example/v3/index.json";
const KEY = "nuget.credentials/https://nuget.example:443";
const GOOD: Credential = { username: "user", password: "s3cr3t" };

function harness(answers: (Credential | undefined)[] = [GOOD]) {
  const secrets = new Map<string, string>();
  let index: readonly string[] = [];
  const asked: { source: string; isRetry: boolean }[] = [];
  const releases: (() => void)[] = [];
  let hold = false;
  const store = new CredentialStore(
    {
      get: async (key) => secrets.get(key),
      store: async (key, value) => void secrets.set(key, value),
      delete: async (key) => void secrets.delete(key)
    },
    { get: () => index, set: async (servers) => void (index = servers) },
    {
      ask: async (source, isRetry) => {
        asked.push({ source, isRetry });
        if (hold) {
          await new Promise<void>((resolve) => releases.push(resolve));
        }

        return answers.shift();
      }
    }
  );
  return {
    store,
    secrets,
    asked,
    index: () => index,
    holdPrompts: () => (hold = true),
    release: () => releases.splice(0).forEach((resolve) => resolve())
  };
}

describe("serverOf", () => {
  it.each([
    ["https://nuget.example/v3/index.json", "https://nuget.example:443"],
    ["http://nuget.example/v3/index.json", "http://nuget.example:80"],
    ["https://nuget.example:8443/feed?x=1#y", "https://nuget.example:8443"],
    ["http://localhost:5000/v3/index.json", "http://localhost:5000"],
    ["https://user:pass@nuget.example/v3/index.json", "https://nuget.example:443"],
    ["HTTPS://NuGet.Example/v3/index.json", "https://nuget.example:443"]
  ])("%s belongs to %s", (source, expected) => {
    expect(serverOf(source)).toBe(expected);
  });

  it.each(["feed", "C:\\packages\\feed", "/srv/feed", "\\\\server\\share", "ftp://nuget.example/feed", ""])(
    "%j is not a server",
    (source) => {
      expect(serverOf(source)).toBeUndefined();
    }
  );
});

describe("CredentialStore", () => {
  it("the first request prompts, stores and answers", async () => {
    const test = harness();

    const answer = await test.store.resolve({ source: FEED, isRetry: false });

    expect(answer).toEqual({ ...GOOD, cancelled: false });
    expect(test.asked).toEqual([{ source: FEED, isRetry: false }]);
    expect(JSON.parse(test.secrets.get(KEY)!)).toEqual(GOOD);
    expect(test.index()).toEqual(["https://nuget.example:443"]);
  });

  it("a later request answers from the store without prompting, for any URL of the server", async () => {
    const test = harness();
    await test.store.resolve({ source: FEED, isRetry: false });

    const answer = await test.store.resolve({
      source: "https://nuget.example/v3/flat/alpha/index.json",
      isRetry: false
    });

    expect(answer).toEqual({ ...GOOD, cancelled: false });
    expect(test.asked).toHaveLength(1);
  });

  it("a retry deletes the stored value and prompts again", async () => {
    const better: Credential = { username: "user", password: "n3w" };
    const test = harness([GOOD, better]);
    await test.store.resolve({ source: FEED, isRetry: false });

    const answer = await test.store.resolve({ source: FEED, isRetry: true });

    expect(answer).toEqual({ ...better, cancelled: false });
    expect(test.asked[1]).toEqual({ source: FEED, isRetry: true });
    expect(JSON.parse(test.secrets.get(KEY)!)).toEqual(better);
    expect(test.index()).toEqual(["https://nuget.example:443"]);
  });

  it("a retry that is cancelled leaves nothing stored", async () => {
    const test = harness([GOOD, undefined]);
    await test.store.resolve({ source: FEED, isRetry: false });

    const answer = await test.store.resolve({ source: FEED, isRetry: true });

    expect(answer).toEqual({ cancelled: true });
    expect(test.secrets.size).toBe(0);
    expect(test.index()).toEqual([]);
  });

  it("cancelling the prompt answers cancelled and stores nothing", async () => {
    const test = harness([undefined]);

    const answer = await test.store.resolve({ source: FEED, isRetry: false });

    expect(answer).toEqual({ cancelled: true });
    expect(test.secrets.size).toBe(0);
    expect(test.index()).toEqual([]);
  });

  it("two requests for the same server share one prompt", async () => {
    const test = harness();
    test.holdPrompts();

    const first = test.store.resolve({ source: FEED, isRetry: false });
    const second = test.store.resolve({ source: "https://nuget.example/v3/query", isRetry: false });
    await new Promise((resolve) => setTimeout(resolve, 10));
    test.release();

    expect(await first).toEqual({ ...GOOD, cancelled: false });
    expect(await second).toEqual({ ...GOOD, cancelled: false });
    expect(test.asked).toHaveLength(1);
  });

  it("requests for different servers prompt separately", async () => {
    const other: Credential = { username: "other", password: "0ther" };
    const test = harness([GOOD, other]);

    await test.store.resolve({ source: FEED, isRetry: false });
    const answer = await test.store.resolve({ source: "https://other.example/v3/index.json", isRetry: false });

    expect(answer).toEqual({ ...other, cancelled: false });
    expect(test.asked).toHaveLength(2);
    expect(test.index()).toHaveLength(2);
  });

  it("clear deletes every indexed secret and the index", async () => {
    const test = harness([GOOD, GOOD]);
    await test.store.resolve({ source: FEED, isRetry: false });
    await test.store.resolve({ source: "http://localhost:5000/v3/index.json", isRetry: false });

    await test.store.clear();

    expect(test.secrets.size).toBe(0);
    expect(test.index()).toEqual([]);
  });

  it("a source that is not a URL is answered as cancelled, without a prompt", async () => {
    const test = harness();

    const answer = await test.store.resolve({ source: "C:\\packages\\feed", isRetry: false });

    expect(answer).toEqual({ cancelled: true });
    expect(test.asked).toEqual([]);
  });

  it("a stored value that cannot be read is asked for again", async () => {
    const test = harness();
    test.secrets.set(KEY, "not json");

    const answer = await test.store.resolve({ source: FEED, isRetry: false });

    expect(answer).toEqual({ ...GOOD, cancelled: false });
    expect(test.asked).toHaveLength(1);
  });

  it("save stores and indexes without prompting, and a later request is answered from it", async () => {
    const test = harness();

    const saved = await test.store.save(FEED, GOOD);
    const answer = await test.store.resolve({ source: FEED, isRetry: false });

    expect(saved).toBe(true);
    expect(answer).toEqual({ ...GOOD, cancelled: false });
    expect(test.asked).toEqual([]);
    expect(test.index()).toEqual(["https://nuget.example:443"]);
  });

  it("save refuses a source that is not a URL", async () => {
    const test = harness();

    expect(await test.store.save("C:\\packages\\feed", GOOD)).toBe(false);
    expect(test.secrets.size).toBe(0);
  });

  it("the index holds addresses only", async () => {
    const test = harness();

    await test.store.resolve({ source: FEED, isRetry: false });

    expect(JSON.stringify(test.index())).not.toContain(GOOD.password);
    expect(JSON.stringify(test.index())).not.toContain(GOOD.username);
  });
});
