# NuGet Manager for VS Code

A NuGet Package Manager based on JetBrains Rider's UI and features.

This is an early build. It starts the NuGet backend for the solution of the workspace, restores it, and keeps it up to date as project files change. The package manager view is not part of this build yet.

## What it does today

- Finds the solutions of the workspace and opens one: the one used last, or the only one. Click **NuGet** in the status bar to pick another.
- Restores the solution when it is opened, and on **NuGet: Restore**.
- Asks for the credentials of private package sources and keeps them in the editor's secret storage.
- Writes what NuGet does to the **NuGet** output channel.

## Requirements

A .NET SDK. The extension looks for `dotnet` in the `nuget.dotnetPath` setting, then in `DOTNET_ROOT`, then on `PATH`.

## License

zlib/libpng.
