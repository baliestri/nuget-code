# Extension

The extension hosts the [backend](backend-protocol.md) inside VS Code and VSCodium. This page describes how it behaves today: the package manager view in the panel, the status bar item, the output channel, credential prompts and a few commands.

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

One item, on the left, that says the state of the backend. Its tooltip says it in a sentence.

| State                                             | Text                                   | A click              |
| ------------------------------------------------- | -------------------------------------- | -------------------- |
| The backend is starting                           | `$(sync~spin) NuGet: starting…`        | Opens the view       |
| The backend is running and is opening a solution  | `$(sync~spin) NuGet: opening…`         | Opens the view       |
| The backend is running, with a solution open      | `$(package) <file name>`               | Opens the view       |
| The backend is running, with no solution selected | `$(package) NuGet: select a solution`  | Selects a solution   |
| The backend is stopped                            | `$(error) NuGet: stopped`, as an error | Restarts the backend |

## The view

The **NuGet** view lives in the panel, beside Terminal and Output, and has four tabs. A column of buttons on its left holds Restore, the actions of the tab, the settings and this page. What the user chose in the view, such as the tab, the target, the feed and the log columns, is remembered for the workspace.

Only one operation that changes packages or restores runs at a time. While one runs, the view says which step it is at and offers **Cancel**; files that were already edited stay edited.

### Packages

The toolbar chooses what the lists are about: a search text, the target (the whole solution or one project), the feed (every enabled feed or one) and whether prerelease versions count.

- **Installed** lists the packages the target references, with the versions in use. Those with a newer version on the feeds are also listed above, in **Packages to Update**, where they can be ticked and updated together to the newest version. A package the SDK adds on its own is shown dimmed and cannot be changed. A package that is not restored carries a warning.
- **Discover** lists what the feeds answer to the search, up to 100 packages.

Selecting a package shows its details: the versions, newest first, its description, authors, licence and dependencies, and the projects of the target. A project that has the package can be moved to the selected version or have the package removed; one that does not can have it installed. The buttons beside the version do the same for every project at once.

A click applies the change at once; nothing asks for confirmation. When the change is done, the view says only what went wrong: a restore that failed, a file that could not be written, a cancellation. What a change did beyond what was asked is a [notification](#settings).

The side bar adds **Refresh**, which asks the feeds again without the backend's cache, the position of the details, beside or below the lists, and the order of the installed list: packages with updates first, or alphabetical.

### Sources

The list has `[Effective NuGet.Config]`, every file combined, and then each configuration file NuGet reads for the solution.

- **Feeds** shows name, URL, **Allow insecure** and **Enabled**, with buttons to edit and remove, and a last row to add a feed. From the effective list a change is written to the file that declares the feed, and a new feed goes to the `NuGet.config` of the solution. From a file's list, changes go to that file. A file that cannot be written is read-only; the feeds of a machine-wide file can still be enabled and disabled.
- **Properties** shows the global packages folder and the local packages folder: what the selected file declares, which can be typed or chosen, and under it what NuGet ends up using. They are read-only in the effective list.
- **Summary** is the effective configuration as text.

The dialog that adds or edits a feed also takes a user and a password. They are stored in the editor's secret storage, as in [Credentials](#credentials), and never written to a `NuGet.config`; leaving them empty keeps what is stored.

### Folders

The folders NuGet uses, with their paths. Sizes start unknown; **Recalculate Folder Sizes** measures them one after the other. **Open Folder** shows the selected folder in the file manager. **Clear Selected Caches** deletes what is in the selected folders, after a confirmation that lists them; it is offered only when every selected folder is a cache. Ctrl or Cmd with a click selects several. Afterwards the view says how much was freed and what could not be removed.

### Log

The last 5,000 lines of the backend's log received since the view opened, coloured by level. The toolbar shows and hides the time, the context and the level, wraps long lines, scrolls to the end, clears the list and chooses which levels are shown; that choice is independent of `nuget.log.level`, which governs the output channel. The list stays at the end as lines arrive until it is scrolled up. The Log tab is shown even while the backend is starting or stopped.

## Commands

| Command                          | What it does                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| `NuGet: Open`                    | Shows the view.                                                                       |
| `NuGet: Select Solution`         | Lists the solutions of the workspace.                                                 |
| `NuGet: Restore`                 | Restores the open solution. The notification can cancel it.                           |
| `NuGet: Restart Backend`         | Stops the backend process and starts a new one.                                       |
| `NuGet: Show Log`                | Shows the NuGet output channel.                                                       |
| `NuGet: Clear Saved Credentials` | Deletes the credentials the extension stored and lets the backend ask for them again. |

A restore that succeeds shows a short message in the status bar. One that fails for some project shows how many failed and offers the log. A cancelled one shows nothing.

## Settings

| Setting                                 | Default    | Effect                                                                                              |
| --------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------- |
| `nuget.dotnetPath`                      | empty      | The `dotnet` executable. When empty, `DOTNET_ROOT` and then `PATH` are used.                        |
| `nuget.restore.engine`                  | `embedded` | `embedded`, `msbuild` or `console`. See [Restore](backend-protocol.md#restore).                     |
| `nuget.restore.onOpen`                  | `true`     | Restore the solution when it is opened.                                                             |
| `nuget.feedTimeoutSeconds`              | `30`       | How long a package source may take to answer.                                                       |
| `nuget.log.level`                       | `info`     | The least severe level written to the output channel.                                               |
| `nuget.backend.path`                    | empty      | Another backend to run, for developing the extension: an executable, or a `.dll` run with `dotnet`. |
| `nuget.notifications.operationWarnings` | `true`     | Show a notification when a package change did more than was asked.                                  |

A package change can do more than was asked: updating a version that `Directory.Packages.props` shares changes it for every project that uses it, for example. The sentences that say so are always written to the output channel. A notification shows the first one, and how many more there are, with **Show Log** and **Don't Show Again**; the latter turns `nuget.notifications.operationWarnings` off in the user settings.

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

The view is a page that talks to the extension over messages. It may call a fixed list of backend methods, which the extension forwards, and a few requests only the extension can answer: opening a folder, the settings or a link, choosing a folder, saving a credential, showing a notification. Links are opened only when they are `http` or `https`, and a folder only when it is one the backend lists. Stored credentials are never sent to the page.
