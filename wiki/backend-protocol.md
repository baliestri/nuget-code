# Backend protocol

The extension host talks to the backend process over JSON-RPC 2.0 on stdin and stdout. Messages are framed with a `Content-Length` header, as in the Language Server Protocol. stderr carries only fatal process errors.

Property names are camelCase and properties whose value is `null` are omitted.

The process exits with code 0 when stdin closes. `shutdown` stops the child processes the backend started and replies; it does not end the process.

The backend loads NuGet configuration from the directory of the open solution. Before a solution is open it uses its working directory, so the host should start it in the workspace folder.

## Requests from the host

| Method | Params | Result |
| --- | --- | --- |
| `initialize` | `dotnetPath?`, `feedTimeoutSeconds?` | `protocolVersion`, `backendVersion`, `sdk?` |
| `shutdown` | — | — |
| `solution/open` | `path`, `projects?` | `path`, `kind`, `projects[]` |
| `solution/close` | — | — |
| `packages/installed` | — | `projects[]`, each with its `packages[]` |
| `packages/updates` | `prerelease`, `noCache`, `progressToken?` | `packages[]`, `failures[]` |
| `packages/search` | `query?`, `feed?`, `prerelease`, `skip`, `take` | `packages[]`, `failures[]` |
| `packages/details` | `id`, `feed?`, `prerelease`, `noCache` | versions, metadata, `failures[]` |
| `sources/list` | — | `files[]`, `effective[]` |
| `folders/list` | — | `folders[]` |
| `folders/size` | `path` | `exists`, `bytes` |

### `initialize`

`sdk` carries `dotnetPath` and `version`. It is absent when no .NET SDK was found. The backend looks for `dotnet` in `dotnetPath`, then in `DOTNET_ROOT`, then on `PATH`. A `dotnetPath` that does not exist is not replaced by a fallback.

Without an SDK, feed, source and folder requests still work; `solution/open` fails with error 1001.

`feedTimeoutSeconds` sets how long a single feed may take to answer. The default is 30 seconds.

### `solution/open`

`path` is a `.sln`, `.slnx` or `.slnf` file. To open a folder that has no solution file, pass the folder as `path` and the project files as `projects`. `kind` is `sln`, `slnx`, `slnf` or `implicit`.

Each project carries `name`, `path`, `frameworks`, `centralPackageManagement` and, when it could not be evaluated, `error`. Frameworks are sorted by framework and version, so `net8.0` comes before `net10.0`; the order in which the project file declares them is not kept.

Opening a solution replaces the previous one. Only `PackageReference` projects are supported.

### `packages/installed`

Each package carries:

| Field | Meaning |
| --- | --- |
| `id` | Package id |
| `requestedVersion` | The version the project asks for, in short form (`1.0.0`, `1.*`) |
| `resolvedVersion` | The version in `obj/project.assets.json`; absent until the project is restored |
| `frameworks` | The target frameworks that reference the package |
| `implicit` | `true` for packages the SDK adds on its own |
| `restored` | Whether a resolved version was found |
| `origin` | Where the version is declared; absent for implicit packages |

`origin` carries `kind` and, when exactly one declaration was found, `file`, `line` and `column` (both starting at 1) of the version attribute or element:

| `origin.kind` | Meaning |
| --- | --- |
| `project` | `Version` on the `PackageReference` in the project file |
| `central` | `PackageVersion` in the nearest `Directory.Packages.props` |
| `versionOverride` | `VersionOverride` in the project file |
| `imported` | `PackageReference` in a `Directory.Build.props` or `Directory.Build.targets` |
| `undetermined` | More than one candidate, a property expression such as `$(Version)`, or nothing found |

### `packages/updates`

For each installed package that is not implicit, `packages[]` carries `id` and `versions[]`: the newest version on each feed that has the package, as `feed` and `version`. The client compares them with what is installed. A package no feed knows has an empty `versions`.

With a `progressToken`, the backend sends `progress` notifications while it works.

### `packages/search` and `packages/details`

Without `feed`, every enabled feed is asked. Search results from several feeds are interleaved and a package id is listed once.

`packages/details` returns `versions` newest first, the metadata of the newest version (`description`, `authors`, `license`, `licenseUrl`, `projectUrl`, `iconUrl`, `dependencyGroups`) and the `feed` it came from. A package no feed knows is an empty `versions` and no `feed`, not an error.

`packageSourceMapping`, when configured, limits which feeds are asked about a package in `packages/details` and `packages/updates`.

`noCache` bypasses the backend's short-lived cache and NuGet's HTTP cache. Search has no such option because search results are not cached.

### `sources/list`

`files[]` lists the `NuGet.config` files in effect, nearest first, each with the `feeds` it declares. `effective[]` is the combined view. A feed carries `name`, `source`, `enabled`, `allowInsecureConnections`, `protocolVersion` and `isLocal`.

### `folders/list` and `folders/size`

`folders[]` carries `title` and `path` for: Local Packages (only with a solution open), Global Packages, Package Cache, HTTP Cache, NuGetHome, UserSettings, MachineSettingsBase, MachineConfigDir, Temp and one `Fallback #n` per fallback folder.

`folders/size` only accepts a path returned by `folders/list`; any other path is error -32602.

## Notifications from the host

| Method | Params | Effect |
| --- | --- | --- |
| `workspace/didChangeFiles` | `paths[]` | Re-evaluates what the changed files affect. |
| `credentials/reset` | `source?` | Lets the backend ask for credentials again after a cancelled prompt. Without `source`, for every feed. |
| `$/cancelRequest` | `id` | Cancels the request with that id. |

The backend does not watch the file system. The host reports changes, and the backend decides what they affect:

| Changed file | Effect |
| --- | --- |
| `Directory.Build.props`, `Directory.Build.targets`, `Directory.Packages.props`, `global.json`, a `NuGet.config`, or the solution file | The whole solution is evaluated again. |
| A project file of the open solution | That project is evaluated again. |
| The `project.assets.json` of a project of the open solution | Nothing is evaluated; the host is told the resolved versions changed. |
| Anything else | Ignored. |

Changes that arrive close together are handled as one. Requests are answered from the previous model until the new one is ready. A change to a `NuGet.config` also discards the cached feed data.

## Notifications from the backend

| Method | Params |
| --- | --- |
| `log/entry` | `level`, `time`, `context`, `message` |
| `solution/didChange` | `projects[]`: paths whose model or resolved versions changed |
| `progress` | `token`, `kind` (`begin`, `report`, `end`), `package?` |

Log levels are `debug`, `verbose`, `info`, `warning` and `error`. `context` is `NUGET` for messages from the NuGet libraries and `VSCODE` for messages from the backend itself. The backend sends every level; filtering is up to the client. Credentials in URLs are masked before a message leaves the process.

## Requests from the backend

| Method | Params | Result |
| --- | --- | --- |
| `credentials/request` | `source`, `isRetry` | `username?`, `password?`, `cancelled` |

The backend asks only after credentials stored in `NuGet.config` and installed credential provider plugins did not resolve the request. `isRetry` is `true` when the feed refused the previous answer. Credentials are kept in memory only.

After a `cancelled` answer the backend does not ask again for that host until the host sends `credentials/reset`.

## Errors

| Code | Meaning |
| --- | --- |
| -32700 to -32600 | Standard JSON-RPC protocol errors |
| -32800 | Request cancelled |
| 1001 | .NET SDK not found |
| 1002 | Solution could not be read |
| 1003 | No solution is open |
| 1004 | No project in the solution could be evaluated |
| 1005 | Feed unreachable |
| 1006 | Authentication refused |

An error carries a `message` ready to display and, when there is one, the MSBuild or NuGet output in `data`.

A request over several feeds or several projects does not fail because of one of them. A failing feed is listed in `failures` with `feed`, `kind` (`unreachable` or `authentication`) and `message`; a failing project carries its own `error`. Errors 1005 and 1006 are returned only when the request named a single `feed`. Error 1004 is returned only when every project failed.

## Project model

Projects are evaluated by running `dotnet msbuild -t:GenerateRestoreGraphFile` with the solution directory as the working directory, so the repository's `global.json` selects the SDK. A `.sln` or `.slnx` is evaluated in one run; if that run fails, and for `.slnf` and implicit solutions, each project is evaluated on its own.
