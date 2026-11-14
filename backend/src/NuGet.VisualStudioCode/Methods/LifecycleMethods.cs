// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Reflection;
using NuGet.VisualStudioCode.Feeds;
using NuGet.VisualStudioCode.Logging;
using NuGet.VisualStudioCode.Operations;
using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.Rpc;
using NuGet.VisualStudioCode.Sdk;

namespace NuGet.VisualStudioCode.Methods;

internal static class LifecycleMethods {
  private const int PROTOCOL_VERSION = 1;

  private readonly static Empty Done = new();

  public static void Register(RpcConnection connection, SdkService sdk, BackendLog log, FeedOptions feedOptions,
    BackendOptions options) {
    connection.OnRequest(MethodNames.INITIALIZE, ProtocolJsonContext.Default.InitializeParams,
      ProtocolJsonContext.Default.InitializeResult, async (parameters, ct) =>
      {
        sdk.Configure(parameters.DotnetPath);
        if (parameters.FeedTimeoutSeconds is > 0) {
          feedOptions.Timeout = TimeSpan.FromSeconds(parameters.FeedTimeoutSeconds.Value);
        }

        options.RestoreEngine = parameters.RestoreEngine ?? options.RestoreEngine;
        options.RestoreOnOpen = parameters.RestoreOnOpen ?? options.RestoreOnOpen;

        var info = await sdk.DescribeAsync(Environment.CurrentDirectory, ct).ConfigureAwait(false);
        log.Write(LogLevels.INFO, LogContexts.BACKEND,
          info is null ? "Backend started without a .NET SDK." : $"Backend started with .NET SDK {info.Version}.");
        return new InitializeResult(PROTOCOL_VERSION, BackendVersion(), info);
      });
    connection.OnRequest(MethodNames.SHUTDOWN, ProtocolJsonContext.Default.Empty,
      ProtocolJsonContext.Default.Empty, (_, _) =>
      {
        ChildProcesses.KillAll();
        return Task.FromResult(Done);
      });
  }

  private static string BackendVersion()
    => typeof(LifecycleMethods).Assembly
      .GetCustomAttribute<AssemblyInformationalVersionAttribute>()
      ?.InformationalVersion ?? "0.0.0";
}
