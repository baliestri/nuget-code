# Releasing NuGet Manager

The `Release` workflow accepts an exact stable version such as `2.0.0` and must be started from `develop`. Review the extension manually in VS Code before triggering it. Automated checks cover code, .NET integration on Windows/Linux with SDKs 8/9/10, and VSIX contents/identity; they do not exercise the installed UI.

The prepare job checks that the dispatch SHA still equals `origin/develop`, that `main` is an ancestor, the working tree is clean, the version increases, and its branch/tag are unused. It creates `release/vX.Y.Z` with the extension manifest version update. The versioned commit is the source SHA for CI and packaging. No version bump occurs in later jobs.

The package job builds one VSIX from a clean checkout, checks the extension manifest, host bundle, webview bundle, required assets and excluded development files, then records its SHA-256 in `artifact.json`. The Actions artifact name includes the source SHA, original run ID and attempt; retention is 90 days. Every later job downloads and verifies that same file. The Marketplace command uses `vsce publish --packagePath`, so it does not rebuild.

After both CI and package gates pass for the prepared SHA, promotion fast-forwards `main` and creates `vX.Y.Z` on that SHA with one atomic push. Divergence or a conflicting tag stops the release. The Marketplace job publishes the VSIX and uploads a receipt containing version, SHA, checksum and original run identity. The GitHub Release attaches the same VSIX, checksum file and metadata to the existing tag. Finally, develop is merged with the released commit; new develop commits are retained. A merge conflict is reported as synchronization pending, while the published release remains valid.

## Recover a partial release

Run `Recover release` with the original version, release workflow run ID and run attempt. It downloads the original VSIX and verifies its checksum, metadata and successful CI/package gates. If the artifact expired or cannot be proven, stop and rebuild through a new reviewed release procedure; recovery never creates a new versioned commit.

Recovery inspects `main`, the tag, Marketplace and GitHub Release before taking any action. It reuses a matching Marketplace receipt if one exists, then performs only pending steps. A Marketplace version without a matching receipt is ambiguous; verify it manually before any further attempt. A conflicting tag or GitHub Release asset stops recovery. Recovery never force-pushes, overwrites a conflicting release, or republishes a verified version. The run summary reports preparation, validation, package, promotion, publication, release and develop synchronization separately.

Release credentials: `GITHUB_TOKEN` must allow the workflow's write jobs to push and create a release. `VSCE_PAT` is exposed only to Marketplace publication jobs. Branch protection that forbids direct fast-forward promotion will stop the workflow; review repository policy rather than bypassing protection.
