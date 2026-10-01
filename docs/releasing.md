# Releasing NuGet Manager

The `Release` workflow accepts an exact stable version such as `2.0.0` and must be started from `develop`. Review the extension manually in VS Code before triggering it. Automated checks cover code, .NET integration on Windows/Linux with SDKs 8/9/10, and VSIX contents/identity; they do not exercise the installed UI.

The prepare job checks that the dispatch SHA still equals `origin/develop`, that `main` is an ancestor, the working tree is clean, the version increases, and its branch/tag are unused. It creates `release/vX.Y.Z` with the extension manifest version update. The versioned commit is the source SHA for CI and packaging. No version bump occurs in later jobs.

The package job builds one VSIX from a clean checkout, checks the extension manifest, host bundle, webview bundle, required assets and excluded development files, then records its SHA-256 in `artifact.json`. The Actions artifact name includes the source SHA, original run ID and attempt; retention is 90 days. Every later job downloads and verifies that same file. The Marketplace command uses `vsce publish --packagePath`, and Open VSX uses `ovsx publish` with the already packaged VSIX. Neither job rebuilds it.

After both CI and package gates pass for the prepared SHA, promotion fast-forwards `main` and creates `vX.Y.Z` on that SHA with one atomic push. Divergence or a conflicting tag stops the release. The Marketplace job publishes first; after it succeeds, Open VSX publishes the same VSIX. Each job uploads a separate receipt containing version, SHA, checksum and original run identity. Only after both succeed does the GitHub Release attach the same VSIX, checksum file and metadata to the existing tag. Finally, develop is merged with the released commit; new develop commits are retained. A merge conflict is reported as synchronization pending, while the published release remains valid.

## Open VSX bootstrap and trusted publishing

The first Open VSX publication is planned for version `2.0.0` through the `Release` workflow. The `baliestri` namespace must already exist. Before triggering the workflow, save the first-publish token as the repository Actions secret `OVSX_PAT`. Do not put the token in the repository, workflow inputs, or command arguments. The Open VSX job reads it only from its environment.

After `2.0.0` is confirmed on Open VSX, register GitHub Actions trusted publishers for `baliestri/nuget-code` in the Open VSX namespace settings. Authorize both `.github/workflows/release.yml` and `.github/workflows/release-recover.yml` if the registry requires a separate entry for each workflow. Then delete the `OVSX_PAT` repository secret. With no PAT present, both jobs use `ovsx publish --trusted-publishing` and require their GitHub OIDC identity; `id-token: write` is scoped to those jobs.

If Open VSX already has a version but its receipt is missing, recovery checks its published VSIX SHA-256 against the original artifact before restoring the receipt. A checksum mismatch or registry lookup error stops the workflow.

## Recover a partial release

Run `Recover release` with the original version, release workflow run ID and run attempt. It downloads the original VSIX and verifies its checksum, metadata and successful CI/package gates. If the artifact expired or cannot be proven, stop and rebuild through a new reviewed release procedure; recovery never creates a new versioned commit.

Recovery inspects `main`, the tag, Marketplace, Open VSX and GitHub Release before taking any action. It reuses matching registry receipts when they exist, then performs only pending steps with the original VSIX. If either registry completes publication after its job times out, recovery compares the published VSIX SHA-256 with the original artifact and reconstructs the missing receipt only when they match. Wait until registry verification finishes before starting recovery. A conflicting tag, checksum or GitHub Release asset stops recovery. Recovery never force-pushes, overwrites a conflicting release, or republishes a verified version. The run summary reports preparation, validation, package, promotion, each publication, release and develop synchronization separately.

Release credentials: `GITHUB_TOKEN` must allow the workflow's write jobs to push and create a release. `VSCE_PAT` is exposed only to Marketplace publication jobs. `OVSX_PAT` is needed only for the first Open VSX publication, until trusted publishing has been configured and the secret removed. Branch protection that forbids direct fast-forward promotion will stop the workflow; review repository policy rather than bypassing protection.
