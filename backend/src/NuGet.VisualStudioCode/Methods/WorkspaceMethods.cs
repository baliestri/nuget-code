// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.Rpc;
using NuGet.VisualStudioCode.Sessions;

namespace NuGet.VisualStudioCode.Methods;

internal static class WorkspaceMethods {
  private const string NUGET_CONFIG = "nuget.config";

  public static void Register(RpcConnection connection, SessionRefresher refresher, Action resetFeeds)
    => connection.OnNotification(MethodNames.WORKSPACE_DID_CHANGE_FILES,
      ProtocolJsonContext.Default.DidChangeFilesParams, parameters =>
      {
        if (parameters.Paths.Any(IsNuGetConfig)) {
          resetFeeds();
        }

        refresher.Report(parameters.Paths);
        return Task.CompletedTask;
      });

  private static bool IsNuGetConfig(string path)
    => string.Equals(Path.GetFileName(path), NUGET_CONFIG, StringComparison.OrdinalIgnoreCase);
}
