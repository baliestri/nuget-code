# NuGet Manager for VS Code

This repository contains the NuGet Manager extension for Visual Studio Code. It brings package browsing, project actions, NuGet source management, cache folders, and logs into a dedicated panel for .NET workspaces.

If you want to use the extension, see the [Marketplace listing](https://marketplace.visualstudio.com/items?itemName=baliestri.nuget-code) and the [extension README](packages/extension/README.md) for features, screenshots, installation, and configuration.

## Repository

| Package                                    | Responsibility                                                        |
| ------------------------------------------ | --------------------------------------------------------------------- |
| [`packages/extension`](packages/extension) | VS Code integration, commands, workspace discovery, and webview host. |
| [`packages/webview`](packages/webview)     | Package Manager interface.                                            |
| [`packages/manager`](packages/manager)     | Package management state and domain logic.                            |
| [`packages/client`](packages/client)       | NuGet feed, cache, and CLI access.                                    |
| [`packages/contracts`](packages/contracts) | Shared messages and data contracts.                                   |

The packages are managed with `pnpm` and built through the root workspace scripts.

## Development

Install the version of `pnpm` declared in [package.json](package.json), then run:

```bash
pnpm install
pnpm run build
pnpm run typecheck
pnpm run lint
pnpm run test
```

Use `pnpm run dev` for the watch build. Running the extension against a .NET workspace requires the `dotnet` CLI; the extension also supports a configured executable path.

## Release

See the [release procedure](docs/releasing.md) for build, validation, and publication steps.

## License

MIT. See [LICENSE.md](LICENSE.md).
