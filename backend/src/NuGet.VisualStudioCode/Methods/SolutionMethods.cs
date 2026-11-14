// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Operations;
using NuGet.VisualStudioCode.Projects;
using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.Restore;
using NuGet.VisualStudioCode.Rpc;
using NuGet.VisualStudioCode.Sessions;
using NuGet.VisualStudioCode.Solutions;

namespace NuGet.VisualStudioCode.Methods;

internal static class SolutionMethods {
  private readonly static Empty Done = new();

  public static void Register(RpcConnection connection, SessionManager sessions, ProjectEvaluator evaluator,
    OperationQueue queue, SolutionOpenRestore openRestore) {
    connection.OnRequest(MethodNames.SOLUTION_OPEN, ProtocolJsonContext.Default.SolutionOpenParams,
      ProtocolJsonContext.Default.SolutionOpenResult, async (parameters, ct) =>
      {
        var solution = await SolutionReader.ReadAsync(parameters.Path, parameters.Projects, ct).ConfigureAwait(false);
        var models = await evaluator.EvaluateAsync(solution, ct).ConfigureAwait(false);

        // What was running or waiting belongs to the solution being left.
        queue.CancelAll();
        sessions.Replace(new Session(solution, models));
        RpcConnection.AfterResponse(openRestore.Start);
        return new SolutionOpenResult(solution.Path, KindName(solution.Kind),
          models.Select(model => model.Info).ToList());
      });
    connection.OnRequest(MethodNames.SOLUTION_CLOSE, ProtocolJsonContext.Default.Empty,
      ProtocolJsonContext.Default.Empty, (_, _) =>
      {
        queue.CancelAll();
        sessions.Close();
        return Task.FromResult(Done);
      });
  }

  private static string KindName(SolutionKind kind)
    => kind switch {
      SolutionKind.Sln => "sln",
      SolutionKind.Slnx => "slnx",
      SolutionKind.Slnf => "slnf",
      var _ => "implicit"
    };
}
