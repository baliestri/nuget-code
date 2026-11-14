// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Operations;
using NuGet.VisualStudioCode.Projects;
using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.Restore;
using NuGet.VisualStudioCode.Rpc;
using NuGet.VisualStudioCode.Sessions;

namespace NuGet.VisualStudioCode.Methods;

internal static class RestoreMethods {
  private readonly static StringComparer PathComparer =
    OperatingSystem.IsWindows() || OperatingSystem.IsMacOS()
      ? StringComparer.OrdinalIgnoreCase
      : StringComparer.Ordinal;

  public static void Register(RpcConnection connection, SessionManager sessions, OperationQueue queue,
    RestoreService restore, SessionRefresher refresher, BackendOptions options) {
    connection.OnRequest(MethodNames.RESTORE_RUN, ProtocolJsonContext.Default.RestoreRunParams,
      ProtocolJsonContext.Default.OperationResult,
      (parameters, ct) => queue.RunAsync(token => RunAsync(sessions, restore, refresher, parameters, token), ct));
    connection.OnNotification(MethodNames.CONFIGURATION_DID_CHANGE, ProtocolJsonContext.Default.ConfigurationParams,
      parameters =>
      {
        options.RestoreEngine = parameters.RestoreEngine ?? options.RestoreEngine;
        options.RestoreOnOpen = parameters.RestoreOnOpen ?? options.RestoreOnOpen;
        return Task.CompletedTask;
      });
  }

  private static async Task<OperationResult> RunAsync(SessionManager sessions, RestoreService restore,
    SessionRefresher refresher, RestoreRunParams parameters, CancellationToken ct) {
    var session = sessions.Require();
    var projects = parameters.Projects?.Select(path => RequireProject(session, path)).ToList() ?? session.Projects;
    var target = new RestoreTarget(session.Solution, projects, parameters.Projects is null, parameters.Force);
    var result = await restore.RestoreAsync(target, parameters.Engine, ct).ConfigureAwait(false);

    // The assets files just written go through the same path as a change reported by the host.
    refresher.Report(projects.Select(project => project.AssetsPath).OfType<string>().ToList());
    return result;
  }

  private static EvaluatedProject RequireProject(Session session, string path)
    => session.Projects.FirstOrDefault(project => PathComparer.Equals(project.Info.Path, path)) ??
       throw new RpcException(RpcErrorCodes.PROJECT_NOT_IN_SESSION,
         $"The project '{path}' is not part of the open solution.");
}
