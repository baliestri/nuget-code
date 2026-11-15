# Package Manager Console

The Package Manager Console is a PowerShell terminal of the editor with cmdlets that manage the NuGet packages of the open solution. It is the counterpart of the console of Visual Studio and of JetBrains Rider, for `PackageReference` projects.

The cmdlets ask the extension, which asks the same [backend](backend-protocol.md) the [NuGet view](nuget-view.md) uses. What one changes, the other shows.

## Opening it

| From                 | How                                                                       |
| -------------------- | ------------------------------------------------------------------------- |
| The view             | The **PMC** button, after the tabs.                                       |
| The command palette  | **NuGet: Open Package Manager Console**.                                  |
| The list of profiles | **NuGet Package Manager Console**, in the `+` menu of the terminal panel. |

When the solution has more than one project, a list asks which one is the default project. Dismissing the list opens nothing. A solution with one project is not asked about.

A window has one console. Opening it again shows the terminal that is open, and asks nothing. After the terminal is closed, the next one starts from the list again: the default project is not remembered.

The console needs a solution to be open, and says so when there is none. The `nuget.console.enabled` setting turns it off: the button and the command are hidden, and the profile, which the editor always lists, opens nothing. A console that is open when the setting is turned off stays open until it is closed.

## PowerShell

The console runs in PowerShell 7, on every platform. Windows PowerShell 5.1 is not used.

The executable is looked for in this order:

1. The `nuget.console.powershellPath` setting. When it is set, nothing else is tried: a path that does not exist, or that does not run as PowerShell, is an error that names the setting.
2. `pwsh` in the `PATH` of the extension host.
3. `pwsh` among the .NET global tools, in `.dotnet/tools` of the home folder.

The first one that is new enough is used. The least version is the one the module was built for, which is the version of `System.Management.Automation` in `backend/Directory.Packages.props`: 7.6.0 today. A newer PowerShell is accepted. An older one in the `PATH` does not end the search.

When none is found, or only older ones, a notification says so and offers:

| Button         | What it does                                                                                                                                             |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install        | Runs `dotnet tool install --global PowerShell --version <version>`, with the version above, in a terminal of its own. Offered when a .NET SDK was found. |
| How to Install | Opens the installation page of PowerShell.                                                                                                               |
| Open Settings  | Opens `nuget.console.powershellPath`.                                                                                                                    |

Nothing is installed without that click, and the notification shows the command. It installs a PowerShell beside whatever the system has, without replacing it. When the command ends well the console opens; otherwise its terminal stays, with the reason.

With Remote SSH, WSL or a container, the console runs where the workspace is, and that is where PowerShell is looked for and installed.

## The default project

The prompt names the default project:

```
PM [App]>
```

A cmdlet acts on it unless `-ProjectName` names another, by name or by the path of the project file. `-ProjectName` and the name of `Set-Project` complete with Tab.

`Get-Package` is the one cmdlet that works without a default project: it then lists the whole solution. The others say `There is no default project. Choose one with Set-Project.`

## Cmdlets

`Get-Help about_NuGetCode` shows a summary in the console.

### `Get-Project`

```powershell
Get-Project             # the default project
Get-Project -All        # every project of the solution
Get-Project Lib, App    # the projects named
```

Returns objects with `ProjectName`, `FullName`, the path of the project file, and `Frameworks`. It is not the project object of Visual Studio: see [What is not here](#what-is-not-here).

### `Set-Project`

```powershell
Set-Project Lib    # Lib becomes the default project
Set-Project        # the editor shows the list of projects
```

Without a name the editor shows the list, marking the current default, and gives the focus back to the terminal afterwards. Dismissing the list keeps the default. `-PassThru` returns the project that became the default.

This cmdlet does not exist in the other consoles, which have a list of projects in their toolbar.

### `Get-Package`

```powershell
Get-Package                       # the packages the default project references
Get-Package json                  # the ones whose id contains "json"
Get-Package -ProjectName Lib
Get-Package -Updates              # the ones with a newer version, with that version
Get-Package -Updates -IncludePrerelease
Get-Package -Transitive           # also the ones that come with other packages
Get-Package -Vulnerable           # the ones with known vulnerabilities
```

Returns objects with `Id`, `Version`, `ProjectName`, `LatestVersion` (with `-Updates`), `IsTransitive`, `Via` and `Advisories` (with `-Vulnerable`). `Version` is the version the last restore resolved or, before a restore, the one the project asks for.

Packages the SDK adds on its own are not listed. `-Vulnerable` includes the transitive packages, with or without `-Transitive`, and lists nothing while `nuget.audit.enabled` is off. A package source that fails to answer is a warning, and the answer of the others is still shown.

### `Find-Package`

```powershell
Find-Package json                          # search the enabled sources
Find-Package json -Source nuget.org -First 5 -Skip 10
Find-Package json -IncludePrerelease
Find-Package Newtonsoft.Json -ExactMatch   # one package, by its id
Find-Package Newtonsoft.Json -ExactMatch -AllVersions
```

Returns objects with `Id`, `Version`, the newest, `Description`, `Authors`, `Source` and, with `-AllVersions`, `Versions`, newest first. `-First` goes up to 100 and is 20 when not given. `-Source` is the name of a package source and completes with Tab.

### `Install-Package`

```powershell
Install-Package Serilog                 # the newest stable version
Install-Package Serilog 4.0.0           # that version
Install-Package Serilog -IncludePrerelease
Install-Package Serilog -ProjectName Lib
```

### `Uninstall-Package`

```powershell
Uninstall-Package Serilog
```

`-Force` and `-RemoveDependencies` are accepted, so that scripts written for other consoles run, and ignored with a warning: removing a `PackageReference` never fails because of other packages, and what came with it leaves with it.

### `Update-Package`

```powershell
Update-Package Serilog                    # to the newest stable version
Update-Package Serilog -Version 3.1.1     # to that version, older or newer
Update-Package Serilog -ToHighestMinor    # the newest with the same major
Update-Package Serilog -ToHighestPatch    # the newest with the same major and minor
Update-Package Serilog -Safe              # the same as -ToHighestPatch
Update-Package -ProjectName App           # every package of App
Update-Package                            # every package of the default project, after asking
Update-Package -Reinstall                 # change no version; restore again
```

`-Version`, `-ToHighestMinor`, `-ToHighestPatch` (or `-Safe`) and `-Reinstall` exclude each other. The bounds are measured from the version the project has: a package already at the newest version of its bound is left alone, and the cmdlet says so. Prereleases count only with `-IncludePrerelease`.

Without an id, every package the project references is updated in one change. When neither an id nor `-ProjectName` is given, the cmdlet asks first, because the default project is easy to forget; `-Force` or `-Confirm:$false` skips the question. A package whose version is a range or a floating version, and was not restored, cannot be compared and is skipped with a warning.

`-Reinstall` restores the project with the `force` option of the backend, which discards what was resolved before.

The pipeline carries the id and the project:

```powershell
Get-Package -Updates | Update-Package -ToHighestMinor
```

### `Sync-Package`

```powershell
Sync-Package Serilog
```

Takes the version the default project has of the package to the other projects of the solution that reference it in another version, in one change. Projects that do not reference the package are not touched.

## How a change runs

The four cmdlets that change packages work the same way:

1. The change is planned, without writing anything.
2. With `-WhatIf` the planned edits are shown, each as the file, the line and the text removed and added, and the cmdlet stops there. `-Confirm` asks before going on.
3. What the plan warns of is written as warnings: a version that is shared with other projects, a downgrade, a range replaced by one version. The sentences are the ones the view shows in its notification.
4. The change is applied. Its steps are shown as progress.
5. For each project, a line says how many files changed and how the restore ended. A file that could not be edited and a restore error are errors of PowerShell, which do not stop the other projects; a restore warning is a warning.

A change is applied at once, as in the view. Changes of the console and of the view take their turn in the same queue of the backend, one at a time.

Stopping a cmdlet while its change runs, with Ctrl+C, asks the backend to cancel the change. The cmdlet then waits for the backend to answer for it, so that nothing is left running unseen. Files that were already edited stay edited.

## What is not here

- **The Entity Framework Core commands** of the Visual Studio console, such as `Add-Migration` and `Update-Database`. They need the project object of Visual Studio, which `Get-Project` does not return here. Use the `dotnet ef` tool.
- **`Add-BindingRedirect`.** It applies to .NET Framework projects, and only `PackageReference` projects are supported.
- **Install and init scripts of packages.** `PackageReference` does not run them.
- **Managing package sources.** That is the Sources tab of the view.

## How it is built

The module is a .NET assembly, `NuGet.VisualStudioCode.Console`, that PowerShell loads. It carries no NuGet library and none of PowerShell's own assemblies. It is the same for every platform.

The extension listens on a named pipe on Windows and on a Unix socket elsewhere, in a folder only the user can open. The name is random, and the terminal learns it, with a random token, from its environment. A request is one line of JSON and is answered with one or more. The extension answers only a fixed list of requests, checks every parameter, and refuses a project that is not of the open solution; a line without the token closes the connection. The module is never given the credentials of a package source.

On Windows the terminal is started with the execution policy `Bypass` for that process, because the module is not signed. Nothing of the machine's policy changes.

## What has been verified

The console was run on Windows x64: the tests of the cmdlets against a real PowerShell 7.6, a smoke test in the editor that opens the console and lists and removes a package through it, and the installation of the pinned PowerShell tool in a folder of its own.

On Linux x64, in a container, the tests of the cmdlets passed against PowerShell 7.6 over the Unix socket. The console itself was not opened in an editor on Linux, and nothing of it was run on macOS, on ARM, on musl or with Remote SSH, WSL or a container as the workspace. Opening the console from the list of terminal profiles, the list of projects giving the focus back to the terminal, Ctrl+C in the terminal and the notification that installs PowerShell were not exercised by a person in the editor.
