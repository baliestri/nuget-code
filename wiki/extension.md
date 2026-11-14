# Extension

The extension hosts the [backend](backend-protocol.md) inside VS Code and VSCodium. This page describes how it behaves today. It has no package manager view yet: what it offers is the status bar item, the output channel, credential prompts and a few commands.

## Activation

The extension activates when the workspace contains a `.sln`, `.slnx`, `.slnf`, `.csproj`, `.fsproj` or `.vbproj` file. It does not activate in an untrusted workspace, because the backend runs MSBuild on the projects, which executes code from the repository. It runs on the workspace side, so with Remote SSH, WSL or a container the backend runs where the files and `dotnet` are.

On activation it starts one backend process for the window, with the first workspace folder as its working directory, and then selects a solution.

The backend binary is the one shipped in the extension for the platform. An extension package holds the binary of one platform only:

| Package target               | Platform                        |
| ---------------------------- | ------------------------------- |
| `win32-x64`, `win32-arm64`   | Windows                         |
| `linux-x64`, `linux-arm64`   | Linux with glibc                |
| `alpine-x64`, `alpine-arm64` | Linux with musl, such as Alpine |
| `darwin-x64`, `darwin-arm64` | macOS                           |

When no .NET SDK is found the backend still starts, and the extension says so with a button that opens the `nuget.dotnetPath` setting. Without an SDK no solution can be opened.

## Solution

The extension looks for `.sln`, `.slnx` and `.slnf` files in the workspace, honouring `files.exclude` and skipping `bin`, `obj` and `node_modules`. A workspace folder with project files and no solution file counts as one implicit solution made of those projects.

A solution is opened without asking in two cases, tried in this order:

1. The solution selected last in this workspace still exists.
2. The workspace has exactly one candidate.

Otherwise nothing is opened until one is selected. With several workspace folders, the candidates of all of them are listed together, grouped by folder.

Selecting a solution replaces the open one. If it cannot be opened, the error from the backend is shown and no solution is left open.

## Status bar

One item, on the left. Clicking it selects a solution, except when the backend is stopped, when it restarts the backend.

| State                                                  | Text                         |
| ------------------------------------------------------ | ---------------------------- |
| The backend is starting, or a solution is being opened | `$(sync~spin) NuGet`         |
| A solution is open                                     | `$(package) <file name>`     |
| No solution is selected                                | `$(package) Select Solution` |
| The backend is stopped                                 | `$(error) NuGet`             |

## Commands

| Command                          | What it does                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| `NuGet: Select Solution`         | Lists the solutions of the workspace.                                                 |
| `NuGet: Restore`                 | Restores the open solution. The notification can cancel it.                           |
| `NuGet: Restart Backend`         | Stops the backend process and starts a new one.                                       |
| `NuGet: Show Log`                | Shows the NuGet output channel.                                                       |
| `NuGet: Clear Saved Credentials` | Deletes the credentials the extension stored and lets the backend ask for them again. |

A restore that succeeds shows a short message in the status bar. One that fails for some project shows how many failed and offers the log. A cancelled one shows nothing.

## Settings

| Setting                    | Default    | Effect                                                                                              |
| -------------------------- | ---------- | --------------------------------------------------------------------------------------------------- |
| `nuget.dotnetPath`         | empty      | The `dotnet` executable. When empty, `DOTNET_ROOT` and then `PATH` are used.                        |
| `nuget.restore.engine`     | `embedded` | `embedded`, `msbuild` or `console`. See [Restore](backend-protocol.md#restore).                     |
| `nuget.restore.onOpen`     | `true`     | Restore the solution when it is opened.                                                             |
| `nuget.feedTimeoutSeconds` | `30`       | How long a package source may take to answer.                                                       |
| `nuget.log.level`          | `info`     | The least severe level written to the output channel.                                               |
| `nuget.backend.path`       | empty      | Another backend to run, for developing the extension: an executable, or a `.dll` run with `dotnet`. |

A change to `nuget.restore.engine` or `nuget.restore.onOpen` is sent to the running backend and applies from the next restore. A change to `nuget.dotnetPath`, `nuget.feedTimeoutSeconds` or `nuget.backend.path` restarts the backend, because it reads them only when it starts. `nuget.log.level` is applied by the extension.

`nuget.dotnetPath` and `nuget.backend.path` name executables, so they are machine settings that a workspace may override only in a trusted workspace.

## File changes

The extension watches solution files, project files, `Directory.Build.props`, `Directory.Build.targets`, `Directory.Packages.props`, `global.json`, `NuGet.config` under any casing, and `obj/project.assets.json`. Changes are collected for 200 ms and reported to the backend together. The backend decides what each change affects.

## Credentials

When the backend asks for the credentials of a package source, the extension looks in the editor's secret storage for the server of that source: its scheme, host and port. One stored credential serves every URL of the same server.

- Found, and the feed has not refused it: it is used without a prompt.
- Not found: the user name and the password are asked for, and stored.
- The feed refused the stored one: it is deleted and asked for again.

Cancelling a prompt makes the backend stop asking for that server until **NuGet: Clear Saved Credentials** runs. Requests that arrive for a server while its prompt is open share that prompt.

Passwords are kept only in secret storage. They are not written to settings or to the log.

## Log

The **NuGet** output channel receives the backend's log, the backend process's error output and the extension's own messages:

```
09:05:07.042 [info] [NUGET] Restored D:\work\App\App.csproj (in 212 ms).
```

The second bracket is where the line comes from: `NUGET` for the NuGet libraries and the external restore engines, `VSCODE` for the backend itself, `HOST` for the extension and for what the backend process prints to its error stream.

## When the backend stops

If the backend process ends on its own, the extension starts it again and reopens the solution that was open. Requests that were waiting for an answer fail.

After three such stops within 60 seconds the extension stops trying, shows an error with **Restart** and **Show Log**, and the status bar item turns into the error state. **NuGet: Restart Backend** starts it again at any time. A restart caused by that command or by a settings change does not count towards the three.

A backend that cannot be started at all, because the binary is missing or cannot be run, is not retried.

## For other extensions and the view

`activate` returns an object with `session`: the typed backend client (`session.api`), the state of the backend and of the solution, and an event for when either changes.
