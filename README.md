# NuGet Manager for VS Code

A NuGet package manager for Visual Studio Code, modelled on the one in JetBrains Rider. The extension is being rewritten around a .NET backend.

What exists today is that backend: a NativeAOT process that answers over JSON-RPC. It reads solutions, projects, NuGet configuration and feeds; installs, updates and removes packages by editing the project files; restores with three engines; and writes package sources. The extension host and the user interface are not written yet.

- [Backend protocol](wiki/backend-protocol.md)
- [Contributing](CONTRIBUTING.md)

## License

zlib/libpng. See [LICENSE.md](LICENSE.md).
