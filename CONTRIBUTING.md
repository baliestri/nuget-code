# Contributing

## Backend

The backend lives in `backend/` and is a .NET 10 console application published with NativeAOT. All commands below run from `backend/`.

### Prerequisites

- .NET SDK 10.0.403 or a later 10.0.4xx patch (`global.json` pins it).
- A native toolchain for NativeAOT publishing. On Windows this is the Visual Studio "Desktop development with C++" workload. `vswhere.exe` must be reachable: if publishing fails with `'vswhere.exe' is not recognized`, add `C:\Program Files (x86)\Microsoft Visual Studio\Installer` to `PATH`. The test harness does this for its own publish.
- JetBrains command line tools (`jb`) on `PATH`.

The backend has only been built, published and tested on Windows x64. Publishing for Linux, macOS, musl and ARM has not been verified.

### Build and test

```powershell
dotnet build NuGet.VisualStudioCode.slnx
dotnet test --project tests/NuGet.VisualStudioCode.Tests
dotnet test --project tests/NuGet.VisualStudioCode.AotTests
```

Tests run on Microsoft.Testing.Platform. Filter with `--filter-class` or `--filter-method`; VSTest filter syntax does not work.

`NuGet.VisualStudioCode.AotTests` publishes the backend with NativeAOT once per run and talks to the binary over stdio, so a run takes longer than the unit tests. It needs no network: it uses folder feeds and a local HTTP server that speaks the NuGet V3 and V2 protocols. Three environment variables change how it runs:

| Variable                        | Effect                                                               |
| ------------------------------- | -------------------------------------------------------------------- |
| `NUGET_VSCODE_BACKEND_PATH`     | Use an already published binary instead of publishing.               |
| `NUGET_VSCODE_BACKEND_MODE=jit` | Run the backend on the JIT runtime instead of the AOT binary.        |
| `NUGET_VSCODE_ONLINE_TESTS=1`   | Also run the tests that reach nuget.org. They are skipped otherwise. |

Tests that restore use `TestWorkspace`, whose `NuGet.config` clears the inherited sources and points `globalPackagesFolder` inside the test's temporary directory, so nothing is read from or written to the machine's package folder. A test that clears a folder must check that the folder is inside its workspace before asking for it to be cleared.

When an AOT test fails, run it again with `NUGET_VSCODE_BACKEND_MODE=jit`. A test that fails in both modes is failing because of the code or the test fixture. A test that passes on the JIT runtime and fails against the AOT binary is failing because of trimming.

### Rules for backend changes

- Every JSON-RPC method needs a test in `NuGet.VisualStudioCode.AotTests`. NuGet.Client is not fully annotated for trimming, so a code path that is not exercised against the AOT binary is not known to work.
- Every type that crosses the protocol is registered in `ProtocolJsonContext`. Reflection-based serialization is disabled.
- Assemblies that must survive trimming are listed in `src/NuGet.VisualStudioCode/Trimming.props`, each group with the reason it is there. `IL2026` is turned off for the native compiler only, because NuGet.Protocol reports its own Newtonsoft.Json call sites; the C# compiler still fails the build on `IL2026` and `IL3050` in this project's code.
- Methods that change state run through `OperationQueue`. Anything a handler must send after its own answer, such as a notification about work it started, is registered with `RpcConnection.AfterResponse`.
- A test that waits for log output waits for a line the backend writes at the end of the work, not for a delay: the log is delivered on its own and may arrive after the answer.
- Package versions live in `Directory.Packages.props`. Editing it by hand keeps its line endings; `dotnet add package` rewrites the file with CRLF.
- New C# files start with the license header from `backend/.editorconfig`.

### Before committing C# changes

```powershell
jb cleanupcode --profile="Built-in: Full Cleanup" NuGet.VisualStudioCode.slnx
jb inspectcode NuGet.VisualStudioCode.slnx --stdout --format=Text
dotnet build NuGet.VisualStudioCode.slnx
```

Review the cleanup diff and resolve the inspection findings, then run the tests. If an inspection finding contradicts the code, such as a type reported as unused that tests do use, run the inspection again with `--swea` and a fresh `--caches-home` before changing anything: a stale cache produces such findings.

## Extension

The JavaScript side is a pnpm workspace:

| Package                   | What it is                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `packages/protocol`       | The backend contract in TypeScript: types, method names, error codes.               |
| `packages/backend-client` | Starts the backend, talks JSON-RPC to it and restarts it. Does not import `vscode`. |
| `packages/bridge`         | The typed requests and events between the view and the extension host.              |
| `apps/webview`            | The view: React and Tailwind, bundled into `apps/extension/dist/webview`.           |
| `apps/extension`          | The VS Code extension, bundled by rolldown into `dist/extension.js`.                |

The workspace packages are consumed as TypeScript source and have no build step of their own. The view has one, because the extension ships its bundle.

### Prerequisites

- Node.js, the version in `.node-version`, and pnpm, the version in `packageManager`.
- The .NET SDK, as for the backend: the tests start it.

### Build and test

All commands run from the repository root.

```powershell
pnpm install
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm --filter nuget-code test:integration
```

`pnpm test` runs the unit tests and the contract tests of `packages/backend-client`. The contract tests start a real backend: the Debug build, which they build first, or the binary named by `NUGET_VSCODE_BACKEND_PATH`. They call every method of the protocol and fail when an answer has a field the TypeScript types do not declare, which is what keeps the types and the backend from drifting apart. `packages/protocol` has a test that compares its constants with the C# source.

`test:integration` runs a few smoke tests inside a real editor, which it downloads to `apps/extension/.vscode-test/` the first time. It opens a workspace it generates there. With `NUGET_VSCODE_BACKEND_BUNDLED=1` the extension finds the backend under `apps/extension/bin/<target>/`, as an installed package does; otherwise it uses the Debug build or `NUGET_VSCODE_BACKEND_PATH`.

To run the extension by hand, open the repository in VS Code and start one of the launch configurations of `.vscode/launch.json`: **Extension** builds the Debug backend into `apps/extension/bin/<target>/`, builds the JavaScript and opens an Extension Development Host; **Extension (sample workspace)** opens it on the workspace of the smoke tests. The folder name of the backend task assumes x64 on Windows and Linux and arm64 on macOS. These configurations were tried on Windows x64 only.

The view can be looked at without the editor, over a fake host with sample data:

```powershell
pnpm --filter @nuget-code/webview dev:page
```

It serves http://127.0.0.1:5199. `?theme=light` switches the theme, `?state=starting`, `stopped`, `none` or `nosdk` shows the states without a backend or a solution, and `?prefs=<json>` starts from stored preferences, such as `{"tab":"log"}`. The page imitates the editor's theme variables; how the view looks in a real theme is only seen in the editor.

### Rules for extension changes

- A module that decides something is written without importing `vscode` and has unit tests. The modules that touch the editor API stay thin; the smoke tests cover them.
- A change to the protocol is made in three places together: the C# records, `packages/protocol`, and the contract test of the method.
- The view reaches the backend only through the methods listed in `packages/bridge/src/backendMethods.ts`, and the editor only through the requests of `messages.ts`. The host checks the params of every host request: they come from a page.
- The view's content security policy allows no inline style markup and no `data:` addresses. Icons are files of the bundle or codicons.
- Components of the view use the colour tokens of `apps/webview/src/styles.css`, which map to the editor's theme, never literal colours. Their tests find elements by role and name.
- Do not pass an explicit `undefined` cancellation token to `vscode-jsonrpc`'s `sendRequest`: it takes it for a second parameter and sends the params as an array.

### Packaging

```powershell
pnpm package win32-x64
```

This publishes the backend with NativeAOT, bundles the extension and writes `release-artifacts/nuget-code-<target>-<version>.vsix`. NativeAOT does not compile from one operating system to another, so a target can only be built on its own system; `--backend <executable>` packages a binary that was published elsewhere.

### Continuous integration

`.github/workflows/ci.yml` runs on pushes to `main` and `develop` and on pull requests: lint, format, types and unit tests; then, for each of the eight targets, on a runner of that system and architecture, the NativeAOT publish, the backend tests and the contract tests against the published binary, and the VSIX, which is kept as an artifact; then the smoke tests in the editor on Windows, Linux and macOS, with the binary taken out of the VSIX. The two musl targets are built and tested in an Alpine container (`scripts/ci/alpine.sh`).

`.github/workflows/release.yml` runs on a `v<version>` tag that matches the version of `apps/extension/package.json`. It attaches the eight VSIX files to a GitHub release and publishes them. A version with a pre-release suffix, such as `3.0.0-alpha.0`, only gets the GitHub release: neither marketplace accepts such a version.

Publishing stores no long-lived secret. Both the Visual Studio Marketplace and Open VSX are published with trusted publishing: the job's OIDC token is exchanged for a short-lived publishing token. The trusted publisher configured on each marketplace names this repository and the workflow file, so renaming `release.yml` breaks publishing.

What has been verified so far: before the view was added, the whole workflow passed in CI, the eight targets and the editor smoke tests on Windows, Linux and macOS. The view itself has only been run locally on Windows x64: its tests, the smoke tests in the editor and the packaging of the `win32-x64` VSIX. It has not been through CI yet, and has not been looked at in an editor on Linux or macOS.

To run what the CI runs for the musl targets on a local machine, start the same container with Docker or Podman from the repository root:

```powershell
podman run --rm -v "${PWD}:/work" -w /work mcr.microsoft.com/dotnet/sdk:10.0-alpine sh scripts/ci/alpine.sh linux-musl-x64
```

It works on a copy inside the container and leaves only `alpine-out/`, which Git ignores.

Tests that depend on what only one system does are skipped elsewhere with `Assert.SkipUnless` or `Assert.SkipWhen`, with the reason: Windows refuses to delete an open file, Unix refuses to delete from a directory without write permission, and a privileged process, such as the root user of the container, is not held back by permissions at all.

## Commits

Commits follow [Conventional Commits](https://www.conventionalcommits.org/). Branches are managed with git-flow: `main` holds releases and `develop` is the integration branch.
