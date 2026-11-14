# NuGet Manager for VS Code

A NuGet Package Manager based on JetBrains Rider's UI and features.

This is an early build.

## What it does today

- Finds the solutions of the workspace and opens one: the one used last, or the only one. The **NuGet** item of the status bar says what the backend is doing.
- Shows the **NuGet** view in the panel:
  - **Packages**: the installed packages of the solution or of one project, the ones with updates, and a search of the feeds. Install, update and remove per project, or update several packages at once.
  - **Sources**: the feeds of each `NuGet.config`, to add, edit, enable and remove, and the packages folders.
  - **Folders**: where NuGet keeps things, how much each folder holds, and a way to clear the caches.
  - **Log**: what NuGet and the backend are doing.
- Restores the solution when it is opened, and on **NuGet: Restore**.
- Asks for the credentials of private package sources and keeps them in the editor's secret storage, never in a `NuGet.config`.

## Requirements

A .NET SDK. The extension looks for `dotnet` in the `nuget.dotnetPath` setting, then in `DOTNET_ROOT`, then on `PATH`.

## License

zlib/libpng.
