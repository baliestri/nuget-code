# Backend protocol

The extension host talks to the backend process over JSON-RPC 2.0 on stdin and stdout. Messages are framed with a `Content-Length` header, as in the Language Server Protocol. stderr carries only fatal process errors.

Property names are camelCase and properties whose value is `null` are omitted.

The process exits with code 0 when stdin closes. `shutdown` stops the child processes the backend started and replies; it does not end the process.

The backend loads NuGet configuration from the directory of the open solution. Before a solution is open it uses its working directory, so the host should start it in the workspace folder.

## Requests from the host

| Method                | Params                                                                                                              | Result                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `initialize`          | `dotnetPath?`, `feedTimeoutSeconds?`, `restoreEngine?`, `restoreOnOpen?`                                            | `protocolVersion`, `backendVersion`, `sdk?`                                                   |
| `shutdown`            | —                                                                                                                   | —                                                                                             |
| `solution/open`       | `path`, `projects?`                                                                                                 | `path`, `kind`, `projects[]`                                                                  |
| `solution/close`      | —                                                                                                                   | —                                                                                             |
| `packages/installed`  | —                                                                                                                   | `projects[]`, each with its `packages[]`                                                      |
| `packages/updates`    | `prerelease`, `noCache`, `progressToken?`                                                                           | `packages[]`, `failures[]`                                                                    |
| `packages/search`     | `query?`, `feed?`, `prerelease`, `skip`, `take`                                                                     | `packages[]`, `failures[]`                                                                    |
| `packages/details`    | `id`, `feed?`, `prerelease`, `noCache`                                                                              | versions, metadata, `failures[]`                                                              |
| `packages/plan`       | `changes[]`                                                                                                         | `edits[]`, `warnings[]`                                                                       |
| `packages/install`    | `id`, `version`, `projects[]`                                                                                       | [operation result](#operation-result)                                                         |
| `packages/update`     | `changes[]`, each with `id`, `version`, `projects[]`                                                                | [operation result](#operation-result)                                                         |
| `packages/remove`     | `id`, `projects[]`                                                                                                  | [operation result](#operation-result)                                                         |
| `restore/run`         | `projects?`, `engine?`, `force`                                                                                     | [operation result](#operation-result)                                                         |
| `operations/cancel`   | —                                                                                                                   | —                                                                                             |
| `sources/list`        | —                                                                                                                   | `files[]`, `effective[]`, `fallbackFolders[]`, `globalPackagesFolder`, `localPackagesFolder?` |
| `sources/add`         | `file?`, `name`, `source`, `enabled?`, `allowInsecureConnections?`, `disableTlsCertificateValidation?`              | the feed as written                                                                           |
| `sources/update`      | `file?`, `name`, `newName?`, `source?`, `enabled?`, `allowInsecureConnections?`, `disableTlsCertificateValidation?` | the feed as written                                                                           |
| `sources/remove`      | `file?`, `name`                                                                                                     | —                                                                                             |
| `sources/setProperty` | `file`, `property`, `value?`                                                                                        | —                                                                                             |
| `folders/list`        | —                                                                                                                   | `folders[]`                                                                                   |
| `folders/size`        | `path`                                                                                                              | `exists`, `bytes`                                                                             |
| `folders/clear`       | `paths[]`                                                                                                           | `folders[]`, each with `path`, `bytesFreed`, `skipped[]`                                      |

### `initialize`

`sdk` carries `dotnetPath` and `version`. It is absent when no .NET SDK was found. The backend looks for `dotnet` in `dotnetPath`, then in `DOTNET_ROOT`, then on `PATH`. A `dotnetPath` that does not exist is not replaced by a fallback.

Without an SDK, feed, source and folder requests still work; `solution/open` fails with error 1001.

`feedTimeoutSeconds` sets how long a single feed may take to answer. The default is 30 seconds.

`restoreEngine` is `embedded` (the default), `msbuild` or `console`; see [Restore](#restore). `restoreOnOpen` (default `true`) says whether opening a solution restores it. Both can be changed later with `configuration/didChange`.

### `solution/open`

`path` is a `.sln`, `.slnx` or `.slnf` file. To open a folder that has no solution file, pass the folder as `path` and the project files as `projects`. `kind` is `sln`, `slnx`, `slnf` or `implicit`.

Each project carries `name`, `path`, `frameworks`, `centralPackageManagement` and, when it could not be evaluated, `error`. Frameworks are sorted by framework and version, so `net8.0` comes before `net10.0`; the order in which the project file declares them is not kept.

Opening a solution replaces the previous one and cancels the operations that were running or waiting for it. Only `PackageReference` projects are supported.

With `restoreOnOpen`, the solution is restored in the background after `solution/open` has answered; the outcome arrives as a `restore/didFinish` notification.

### `packages/installed`

Each package carries:

| Field              | Meaning                                                                        |
| ------------------ | ------------------------------------------------------------------------------ |
| `id`               | Package id                                                                     |
| `requestedVersion` | The version the project asks for, in short form (`1.0.0`, `1.*`)               |
| `resolvedVersion`  | The version in `obj/project.assets.json`; absent until the project is restored |
| `frameworks`       | The target frameworks that reference the package                               |
| `implicit`         | `true` for packages the SDK adds on its own                                    |
| `restored`         | Whether a resolved version was found                                           |
| `origin`           | Where the version is declared; absent for implicit packages                    |

`origin` carries `kind` and, when exactly one declaration was found, `file`, `line` and `column` (both starting at 1) of the version attribute or element:

| `origin.kind`     | Meaning                                                                               |
| ----------------- | ------------------------------------------------------------------------------------- |
| `project`         | `Version` on the `PackageReference` in the project file                               |
| `central`         | `PackageVersion` in the nearest `Directory.Packages.props`                            |
| `versionOverride` | `VersionOverride` in the project file                                                 |
| `imported`        | `PackageReference` in a `Directory.Build.props` or `Directory.Build.targets`          |
| `undetermined`    | More than one candidate, a property expression such as `$(Version)`, or nothing found |

An `undetermined` origin only means the position cannot be shown. It does not stop the package from being updated.

### `packages/updates`

For each installed package that is not implicit, `packages[]` carries `id` and `versions[]`: the newest version on each feed that has the package, as `feed` and `version`. The client compares them with what is installed. A package no feed knows has an empty `versions`.

With a `progressToken`, the backend sends `progress` notifications while it works.

### `packages/search` and `packages/details`

Without `feed`, every enabled feed is asked. Search results from several feeds are interleaved and a package id is listed once.

`packages/details` returns `versions` newest first, the metadata of the newest version (`description`, `authors`, `license`, `licenseUrl`, `projectUrl`, `iconUrl`, `dependencyGroups`) and the `feed` it came from. A package no feed knows is an empty `versions` and no `feed`, not an error.

`packageSourceMapping`, when configured, limits which feeds are asked about a package in `packages/details` and `packages/updates`.

`noCache` bypasses the backend's short-lived cache and NuGet's HTTP cache. Search has no such option because search results are not cached.

### `sources/list`

`files[]` lists the `NuGet.config` files in effect, nearest first. Each carries:

| Field                                    | Meaning                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| `path`                                   | The file                                                                 |
| `feeds`                                  | The feeds this file declares                                             |
| `writable`                               | `false` for a machine-wide file and for a read-only file                 |
| `isMachineWide`                          | Whether the file is in one of NuGet's machine-wide configuration folders |
| `globalPackagesFolder`, `repositoryPath` | The values this file declares, as written; absent when it declares none  |

`effective[]` is the combined view. A feed carries `name`, `source`, `enabled`, `allowInsecureConnections`, `disableTlsCertificateValidation`, `protocolVersion`, `isLocal`, `isMachineWide` and `declaredIn`, the nearest file that declares it.

`fallbackFolders`, `globalPackagesFolder` and `localPackagesFolder` are the resolved folders. `localPackagesFolder` is absent when no file sets `repositoryPath`.

### Writing sources

All four methods write through NuGet's own configuration API and take their turn in the [operation queue](#operations). After a write the backend discards its cached feed data and evaluates the solution again, as it does when the host reports a changed `NuGet.config`.

| Method                             | Which file                                                                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sources/add`                      | `file`, or the configuration file in the solution directory. It is created when missing. Without an open solution, the working directory is used. |
| `sources/update`, `sources/remove` | `file`, or the nearest file that declares the feed.                                                                                               |
| `sources/setProperty`              | `file`, which is required. It is created when missing.                                                                                            |

`sources/update` changes only the fields that are present. `newName` renames the feed.

`sources/setProperty` accepts `globalPackagesFolder` and `repositoryPath`. A missing or empty `value` removes the setting.

A machine-wide file is never written. The one change accepted for a feed declared there is `sources/update` with only `enabled`: the feed is disabled or enabled in the user's configuration file, which is where NuGet records it. Anything else is error 1106.

### `folders/list`, `folders/size` and `folders/clear`

`folders[]` carries `title`, `path` and `clearable` for: Local Packages (only with a solution open), Global Packages, Package Cache, HTTP Cache, NuGetHome, UserSettings, MachineSettingsBase, MachineConfigDir, Temp and one `Fallback #n` per fallback folder. `clearable` is `true` for Global Packages, Package Cache, HTTP Cache and Temp.

`folders/size` only accepts a path returned by `folders/list`; any other path is error -32602.

`folders/clear` empties folders and keeps the folders themselves. Every path must be a `clearable` folder of `folders/list`; if one is not, the request fails with error 1109 and nothing is deleted. A file that is in use or cannot be deleted is skipped and listed in `skipped` (at most 50 paths per folder). Symbolic links and junctions are removed as links and not followed.

## Planning a change

`packages/plan` says what a change would write, without writing it. `changes[]` uses the same shape for the three kinds:

| Field      | Meaning                                |
| ---------- | -------------------------------------- |
| `kind`     | `install`, `update` or `remove`        |
| `id`       | Package id                             |
| `version`  | Required for `install` and `update`    |
| `projects` | Paths of projects of the open solution |

`edits[]` lists the text replacements, each with `file`, `line` (starting at 1), `oldText` and `newText`. An insertion has an empty `oldText` and a removal an empty `newText`.

`warnings[]` describe consequences the user may not expect. None of them stops the change. Each carries `kind`, `packageId`, and, depending on the kind, `file`, `projects[]`, `packages[]` and `detail`:

| `kind`              | Meaning                                                                                                                                | Extra fields                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `centralShared`     | The edit is in `Directory.Packages.props` and changes the version for other projects too.                                              | `file`, `projects` that use the central version                        |
| `importedShared`    | The edit is in a `Directory.Build.props` or `Directory.Build.targets`.                                                                 | `file`, `projects` below that file                                     |
| `propertyShared`    | The version comes from a property that other packages also use.                                                                        | `file`, `packages` using the property, `detail` with the property name |
| `literalWrite`      | The version was an expression that could not be traced to one editable property, so the expression is replaced by the literal version. | `file`, `detail` with the expression                                   |
| `rangeReplaced`     | The declared value was a range or a floating version and is replaced by one version.                                                   | `file`, `detail` with the old value                                    |
| `downgrade`         | The new version is lower than the declared one.                                                                                        | `file`, `detail` with the old version                                  |
| `centralRemoved`    | Removing the last reference also removes the `PackageVersion` from `Directory.Packages.props`.                                         | `file`                                                                 |
| `removeItem`        | The package is declared in an imported file, so the project opts out with `<PackageReference Remove="..." />` instead.                 | `file`                                                                 |
| `frameworkMismatch` | The package version lists no framework compatible with one of the project's target frameworks.                                         | `projects`, `detail` with the frameworks                               |

`frameworkMismatch` needs the feed. When no feed answers, the warning is simply absent.

## How packages are edited

The backend edits project files as text, at the positions it located, and changes nothing else: indentation, quotes, line endings, encoding, byte order mark and comments are kept. A file is replaced in one step, through a temporary file next to it.

### Update

| Where the version is declared                                            | What is edited                                      |
| ------------------------------------------------------------------------ | --------------------------------------------------- |
| `Version` attribute or child element of the `PackageReference`           | That value                                          |
| `VersionOverride` on the `PackageReference`                              | The override, not the central version               |
| `PackageVersion` in `Directory.Packages.props`                           | The central version, for every project that uses it |
| `PackageReference` in an imported `Directory.Build.props` or `.targets`  | The value in that file                              |
| A property, such as `$(AlphaVersion)`, defined once with a literal value | The property definition                             |
| An expression that is not one such property                              | The expression is replaced by the version           |

When a package has several declarations, for instance one per target framework, only those holding the version the project currently asks for are edited.

### Install

A package the project already references is updated instead.

Otherwise a `PackageReference` line is added to the first unconditional `ItemGroup` that already holds package references: in alphabetical position when that group is sorted, at its end when it is not. The new line copies the indentation, quote character and closing style of its neighbours. When no such group exists, a new `ItemGroup` is added before `</Project>`.

With central package management the reference is added without a version, and `Directory.Packages.props` gets the `PackageVersion`, by the same rules. If the central file already has a version for the package, that version is moved to the one asked for.

### Remove

The `PackageReference` is removed with its whole line, and an `ItemGroup` left without items goes with it. With central package management, the `PackageVersion` is removed too when no other project of the solution references the package.

A package that comes from an imported file is not removed from that file: the project gets a `<PackageReference Remove="..." />` item.

## Operations

`packages/install`, `packages/update`, `packages/remove`, `restore/run`, the `sources/*` writes and `folders/clear` change state. They run one at a time, in the order they arrive. Requests that only read are answered meanwhile.

A package change goes through these steps, each announced with an `operation/progress` notification:

| `step`       | What happens                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------- |
| `planning`   | The edits are planned. Request errors (1101 to 1104) are raised here, before any file is written.   |
| `editing`    | The files are written. A file that changed since it was planned is planned again once.              |
| `evaluating` | The affected projects are evaluated again. `solution/didChange` is sent.                            |
| `restoring`  | The affected projects are restored: the projects of the change and those that share an edited file. |
| `done`       | The result is about to be returned.                                                                 |

Without any file written, the last two steps before `done` are skipped.

The backend remembers what it wrote. A `workspace/didChangeFiles` notification about a file whose content is still what the backend evaluated does not cause a second evaluation.

### Operation result

| Field        | Meaning                                                                          |
| ------------ | -------------------------------------------------------------------------------- |
| `engine`     | The restore engine that ran; absent when nothing was restored                    |
| `fellBack`   | `true` when the embedded engine could not run and the console engine ran instead |
| `projects[]` | One entry per affected project                                                   |

Each project carries `project` (its path), `changedFiles[]`, `editErrors[]`, `restore` and `messages[]`. A message has `level` (`warning` or `error`), `code` (such as `NU1101`, when there is one) and `message`.

| `restore`               | Meaning                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| `succeeded`             | Restored without messages                                                                  |
| `succeededWithWarnings` | Restored; `messages` holds the warnings                                                    |
| `failed`                | Not restored; `messages` says why                                                          |
| `cancelled`             | The operation was cancelled before the restore finished                                    |
| `notRun`                | Not attempted: nothing was written, or a file this project depends on could not be written |

A restore that fails is a result, not a request error. The edit stays in the file: the backend never refuses or undoes a change because of what the restore says. The same holds for a file that could not be written: it is reported in `editErrors` of the projects that depend on it, and the other projects go on.

### Cancelling

`operations/cancel` cancels the operation that is running. The request being cancelled still answers normally, with `cancelled` as the `restore` state; files already written stay written. Operations waiting in the queue are not affected.

`$/cancelRequest` cancels one request by id. Opening or closing a solution cancels every running and waiting operation; a waiting one answers with error -32800.

## Restore

| Engine     | How it restores                                                                                                                              |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `embedded` | Inside the backend process, with NuGet's own restore command, from the restore graph of the last evaluation. No `dotnet` process is started. |
| `msbuild`  | `dotnet msbuild <target> -t:Restore`                                                                                                         |
| `console`  | `dotnet restore <target>`                                                                                                                    |

The engine is the one named in `restore/run`, else the configured one. An unknown name is error 1105.

The embedded engine falls back to `console` only when it could not run at all, and says so in the log and in `fellBack`. A project that failed to restore is not a reason to fall back. `msbuild` and `console` never fall back.

`restore/run` without `projects` restores the whole solution. `force` turns off NuGet's "nothing changed" shortcut. After a restore the backend sends `solution/didChange` for the restored projects.

Restore happens:

- after a package change made through the backend;
- when a solution is opened, unless `restoreOnOpen` is `false`;
- on `restore/run`.

A file changed outside the backend is evaluated again but not restored.

The two external engines run on the solution file for a whole `.sln` or `.slnx`, and project by project otherwise. Each line they print goes to the log with context `NUGET`. Lines of the form `<origin> : error|warning NU1234: <message> [<project>]` become the `messages` of the project they name; when the process fails without any such line, every project of that run is `failed` with the exit code.

Credentials the host supplied in this session are passed to the external engines through `NuGetPackageSourceCredentials_<name>` environment variables of the child process. A source whose name cannot be part of a variable name is skipped, with a warning in the log. When a run fails with `NU1301` and a 401 from a feed that has no credentials yet, the backend sends `credentials/request` for that feed and, given an answer, runs once more.

## Notifications from the host

| Method                     | Params                             | Effect                                                                                                                                    |
| -------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace/didChangeFiles` | `paths[]`                          | Re-evaluates what the changed files affect.                                                                                               |
| `configuration/didChange`  | `restoreEngine?`, `restoreOnOpen?` | Changes the settings given in `initialize`. Absent fields keep their value.                                                               |
| `credentials/reset`        | `source?`                          | Lets the backend ask for credentials again after a cancelled prompt, and forgets the ones it was given. Without `source`, for every feed. |
| `$/cancelRequest`          | `id`                               | Cancels the request with that id.                                                                                                         |

A new `restoreEngine` applies from the next restore. The name is checked when it is used, not when it arrives.

The backend does not watch the file system. The host reports changes, and the backend decides what they affect:

| Changed file                                                                                                                          | Effect                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `Directory.Build.props`, `Directory.Build.targets`, `Directory.Packages.props`, `global.json`, a `NuGet.config`, or the solution file | The whole solution is evaluated again.                                |
| A project file of the open solution                                                                                                   | That project is evaluated again.                                      |
| The `project.assets.json` of a project of the open solution                                                                           | Nothing is evaluated; the host is told the resolved versions changed. |
| Anything else                                                                                                                         | Ignored.                                                              |

Changes that arrive close together are handled as one. Requests are answered from the previous model until the new one is ready. A change to a `NuGet.config` also discards the cached feed data.

## Notifications from the backend

| Method               | Params                                                                        |
| -------------------- | ----------------------------------------------------------------------------- |
| `log/entry`          | `level`, `time`, `context`, `message`                                         |
| `solution/didChange` | `projects[]`: paths whose model or resolved versions changed                  |
| `progress`           | `token`, `kind` (`begin`, `report`, `end`), `package?`                        |
| `operation/progress` | `step`: `planning`, `editing`, `evaluating`, `restoring` or `done`            |
| `restore/didFinish`  | `reason` (`solutionOpen`), `result`: an [operation result](#operation-result) |

Log levels are `debug`, `verbose`, `info`, `warning` and `error`. `context` is `NUGET` for messages from the NuGet libraries and from the external restore engines, and `VSCODE` for messages from the backend itself. The backend sends every level; filtering is up to the client. Credentials in URLs are masked before a message leaves the process.

`restore/didFinish` is sent only for the restore that follows `solution/open`, and always after the answer to that request. A restore asked for with a request reports through the request's result.

## Requests from the backend

| Method                | Params              | Result                                |
| --------------------- | ------------------- | ------------------------------------- |
| `credentials/request` | `source`, `isRetry` | `username?`, `password?`, `cancelled` |

The backend asks only after credentials stored in `NuGet.config` and installed credential provider plugins did not resolve the request. `isRetry` is `true` when the feed refused the previous answer. Credentials are kept in memory only.

After a `cancelled` answer the backend does not ask again for that host until the host sends `credentials/reset`.

## Errors

| Code             | Meaning                                                                                                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| -32700 to -32600 | Standard JSON-RPC protocol errors                                                                                                                                             |
| -32800           | Request cancelled                                                                                                                                                             |
| 1001             | .NET SDK not found                                                                                                                                                            |
| 1002             | Solution could not be read                                                                                                                                                    |
| 1003             | No solution is open                                                                                                                                                           |
| 1004             | No project in the solution could be evaluated                                                                                                                                 |
| 1005             | Feed unreachable                                                                                                                                                              |
| 1006             | Authentication refused                                                                                                                                                        |
| 1101             | The project is not part of the open solution                                                                                                                                  |
| 1102             | The project does not reference the package                                                                                                                                    |
| 1103             | The package is added by the SDK and has no declaration to change                                                                                                              |
| 1104             | The file cannot take the edit: no version declaration was found, no `Directory.Packages.props` exists for a centrally managed project, or the project element is self-closing |
| 1105             | Unknown restore engine                                                                                                                                                        |
| 1106             | The configuration file cannot be changed                                                                                                                                      |
| 1107             | No configuration file declares the source                                                                                                                                     |
| 1108             | The file already declares a source with that name                                                                                                                             |
| 1109             | The folder is not a NuGet cache folder                                                                                                                                        |

An error carries a `message` ready to display and, when there is one, the MSBuild or NuGet output in `data`.

A request over several feeds or several projects does not fail because of one of them. A failing feed is listed in `failures` with `feed`, `kind` (`unreachable` or `authentication`) and `message`; a failing project carries its own `error`. Errors 1005 and 1006 are returned only when the request named a single `feed`. Error 1004 is returned only when every project failed.

## Project model

Projects are evaluated by running `dotnet msbuild -t:GenerateRestoreGraphFile` with the solution directory as the working directory, so the repository's `global.json` selects the SDK. A `.sln` or `.slnx` is evaluated in one run; if that run fails, and for `.slnf` and implicit solutions, each project is evaluated on its own.
