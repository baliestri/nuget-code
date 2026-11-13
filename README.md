# NuGet Manager for VS Code

A NuGet package manager for Visual Studio Code, modelled on the one in JetBrains Rider. The extension is being rewritten around a .NET backend.

What exists today is the read side of that backend: a NativeAOT process that reads solutions, projects, NuGet configuration and feeds, and answers over JSON-RPC. Installing, updating and restoring packages, the extension host and the user interface are not written yet.

- [Backend protocol](wiki/backend-protocol.md)
- [Contributing](CONTRIBUTING.md)

## License

zlib/libpng. See [LICENSE.md](LICENSE.md).
