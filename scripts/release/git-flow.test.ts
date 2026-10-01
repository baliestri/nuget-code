import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { git, gitSucceeds } from "./git.ts";
import { prepareRelease } from "./prepare.ts";
import { promoteRelease } from "./promote.ts";
import { syncDevelop } from "./sync.ts";

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nuget-release-git-"));
  const bare = path.join(root, "origin.git");
  const repo = path.join(root, "repo");
  git(root, ["init", "--bare", bare]);
  git(root, ["clone", bare, repo]);
  git(repo, ["config", "user.name", "Release Test"]);
  git(repo, ["config", "user.email", "release-test@example.invalid"]);
  await fs.mkdir(path.join(repo, "packages", "extension"), { recursive: true });
  await fs.writeFile(
    path.join(repo, "packages", "extension", "package.json"),
    '{"name":"nuget-code","version":"1.1.0"}\n',
  );
  await fs.writeFile(path.join(repo, "README.md"), "start\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "start"]);
  git(repo, ["branch", "-M", "main"]);
  git(repo, ["push", "origin", "main"]);
  git(repo, ["checkout", "-b", "develop"]);
  git(repo, ["push", "origin", "develop"]);
  return {
    root,
    repo,
    bare,
    dispose: () => fs.rm(root, { recursive: true, force: true, maxRetries: 5 }),
  };
}

it("prepares one versioned SHA, promotes atomically and preserves later develop commits", async () => {
  const state = await fixture();
  try {
    const eventSha = git(state.repo, ["rev-parse", "HEAD"]);
    const prepared = await prepareRelease(state.repo, "2.0.0", eventSha);
    expect(
      git(state.repo, ["ls-remote", "origin", `refs/heads/${prepared.branch}`]),
    ).toContain(prepared.sourceSha);
    expect(() =>
      promoteRelease(state.repo, prepared, [
        prepared.sourceSha,
        "b".repeat(40),
      ]),
    ).toThrow("gates");
    expect(
      git(state.repo, ["ls-remote", "origin", "refs/heads/main"]),
    ).toContain(eventSha);
    promoteRelease(state.repo, prepared, [
      prepared.sourceSha,
      prepared.sourceSha,
    ]);
    expect(
      git(state.repo, ["ls-remote", "origin", "refs/heads/main"]),
    ).toContain(prepared.sourceSha);
    expect(
      git(state.repo, ["ls-remote", "origin", `refs/tags/${prepared.tag}`]),
    ).toContain(prepared.sourceSha);
    git(state.repo, ["checkout", "develop"]);
    await fs.writeFile(path.join(state.repo, "later.txt"), "later\n");
    git(state.repo, ["add", "later.txt"]);
    git(state.repo, ["commit", "-m", "later"]);
    git(state.repo, ["push", "origin", "develop"]);
    expect(syncDevelop(state.repo, prepared)).toBe("synced");
    git(state.repo, ["fetch", "origin", "develop"]);
    expect(
      gitSucceeds(state.repo, [
        "merge-base",
        "--is-ancestor",
        prepared.sourceSha,
        "origin/develop",
      ]),
    ).toBe(true);
    expect(await fs.readFile(path.join(state.repo, "later.txt"), "utf8")).toBe(
      "later\n",
    );
  } finally {
    await state.dispose();
  }
});

it("rejects concurrent main advancement without moving main or tag", async () => {
  const state = await fixture();
  try {
    const prepared = await prepareRelease(
      state.repo,
      "2.0.0",
      git(state.repo, ["rev-parse", "HEAD"]),
    );
    git(state.repo, ["checkout", "main"]);
    await fs.writeFile(path.join(state.repo, "main-only.txt"), "changed\n");
    git(state.repo, ["add", "main-only.txt"]);
    git(state.repo, ["commit", "-m", "advance main"]);
    git(state.repo, ["push", "origin", "main"]);
    git(state.repo, ["checkout", prepared.branch]);
    expect(() =>
      promoteRelease(state.repo, prepared, [
        prepared.sourceSha,
        prepared.sourceSha,
      ]),
    ).toThrow("diverged");
    expect(
      git(state.repo, ["ls-remote", "origin", `refs/tags/${prepared.tag}`]),
    ).toBe("");
  } finally {
    await state.dispose();
  }
});

it("rejects a tag already assigned to a different commit", async () => {
  const state = await fixture();
  try {
    const original = git(state.repo, ["rev-parse", "HEAD"]);
    const prepared = await prepareRelease(state.repo, "2.0.0", original);
    git(state.repo, ["tag", prepared.tag, original]);
    git(state.repo, ["push", "origin", prepared.tag]);
    expect(() =>
      promoteRelease(state.repo, prepared, [
        prepared.sourceSha,
        prepared.sourceSha,
      ]),
    ).toThrow("tag points to another SHA");
    expect(git(state.repo, ["rev-parse", "origin/main"])).toBe(original);
  } finally {
    await state.dispose();
  }
});

it("reports a develop merge conflict without moving the remote branch", async () => {
  const state = await fixture();
  try {
    const prepared = await prepareRelease(
      state.repo,
      "2.0.0",
      git(state.repo, ["rev-parse", "HEAD"]),
    );
    promoteRelease(state.repo, prepared, [
      prepared.sourceSha,
      prepared.sourceSha,
    ]);
    git(state.repo, ["checkout", "develop"]);
    await fs.writeFile(
      path.join(state.repo, "packages", "extension", "package.json"),
      '{"name":"nuget-code","version":"1.2.0"}\n',
    );
    git(state.repo, ["add", "."]);
    git(state.repo, ["commit", "-m", "develop package version"]);
    git(state.repo, ["push", "origin", "develop"]);
    const develop = git(state.repo, ["rev-parse", "origin/develop"]);
    expect(syncDevelop(state.repo, prepared)).toBe("conflict");
    expect(git(state.repo, ["rev-parse", "origin/develop"])).toBe(develop);
  } finally {
    await state.dispose();
  }
});
