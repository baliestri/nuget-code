// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Reflection;
using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.Rpc;

namespace NuGet.VisualStudioCode.Methods;

internal static class LifecycleMethods {
  private const int PROTOCOL_VERSION = 1;

  private readonly static Empty Done = new();

  public static void Register(RpcConnection connection) {
    connection.OnRequest(
      MethodNames.INITIALIZE,
      ProtocolJsonContext.Default.InitializeParams,
      ProtocolJsonContext.Default.InitializeResult,
      (_, _) => Task.FromResult(new InitializeResult(PROTOCOL_VERSION, BackendVersion(), null))
    );
    connection.OnRequest(
      MethodNames.SHUTDOWN,
      ProtocolJsonContext.Default.Empty,
      ProtocolJsonContext.Default.Empty,
      (_, _) => Task.FromResult(Done)
    );
  }

  private static string BackendVersion()
    => typeof(LifecycleMethods).Assembly
      .GetCustomAttribute<AssemblyInformationalVersionAttribute>()
      ?.InformationalVersion ?? "0.0.0";
}
