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

| Variable | Effect |
| --- | --- |
| `NUGET_VSCODE_BACKEND_PATH` | Use an already published binary instead of publishing. |
| `NUGET_VSCODE_BACKEND_MODE=jit` | Run the backend on the JIT runtime instead of the AOT binary. |
| `NUGET_VSCODE_ONLINE_TESTS=1` | Also run the tests that reach nuget.org. They are skipped otherwise. |

When an AOT test fails, run it again with `NUGET_VSCODE_BACKEND_MODE=jit`. A test that fails in both modes is failing because of the code or the test fixture. A test that passes on the JIT runtime and fails against the AOT binary is failing because of trimming.

### Rules for backend changes

- Every JSON-RPC method needs a test in `NuGet.VisualStudioCode.AotTests`. NuGet.Client is not fully annotated for trimming, so a code path that is not exercised against the AOT binary is not known to work.
- Every type that crosses the protocol is registered in `ProtocolJsonContext`. Reflection-based serialization is disabled.
- Assemblies that must survive trimming are listed in `src/NuGet.VisualStudioCode/Trimming.props`, each group with the reason it is there. `IL2026` is turned off for the native compiler only, because NuGet.Protocol reports its own Newtonsoft.Json call sites; the C# compiler still fails the build on `IL2026` and `IL3050` in this project's code.
- Package versions live in `Directory.Packages.props`. Editing it by hand keeps its line endings; `dotnet add package` rewrites the file with CRLF.
- New C# files start with the license header from `backend/.editorconfig`.

### Before committing C# changes

```powershell
jb cleanupcode --profile="Built-in: Full Cleanup" NuGet.VisualStudioCode.slnx
jb inspectcode NuGet.VisualStudioCode.slnx --stdout --format=Text
dotnet build NuGet.VisualStudioCode.slnx
```

Review the cleanup diff and resolve the inspection findings, then run the tests. If an inspection finding contradicts the code, such as a type reported as unused that tests do use, run the inspection again with `--swea` and a fresh `--caches-home` before changing anything: a stale cache produces such findings.

## Commits

Commits follow [Conventional Commits](https://www.conventionalcommits.org/). Branches are managed with git-flow: `main` holds releases and `develop` is the integration branch.
