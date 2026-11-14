# NuGet Manager for VS Code

A NuGet package manager for Visual Studio Code, modelled on the one in JetBrains Rider. The extension is being rewritten around a .NET backend.

What exists today:

- The backend: a NativeAOT process that answers over JSON-RPC. It reads solutions, projects, NuGet configuration and feeds; installs, updates and removes packages by editing the project files; restores with three engines; and writes package sources.
- The extension host: it starts the backend, selects and opens a solution, restores it, reports file and setting changes, answers credential requests from secret storage and shows the log.
- The view, in the panel: installed packages and their updates, search, install, update and remove per project; package sources; NuGet folders and caches; the log.

It has not been published yet. What is still ahead is trying it on more solutions and systems before a first release.

- [Extension](wiki/extension.md)
- [Backend protocol](wiki/backend-protocol.md)
- [Contributing](CONTRIBUTING.md)

## License

zlib/libpng. See [LICENSE.md](LICENSE.md).
