// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.Rpc;
using NuGet.VisualStudioCode.Sessions;

namespace NuGet.VisualStudioCode.Methods;

internal static class WorkspaceMethods {
  public static void Register(RpcConnection connection, SessionRefresher refresher)
    => connection.OnNotification(MethodNames.WORKSPACE_DID_CHANGE_FILES,
      ProtocolJsonContext.Default.DidChangeFilesParams, parameters =>
      {
        refresher.Report(parameters.Paths);
        return Task.CompletedTask;
      });
}
