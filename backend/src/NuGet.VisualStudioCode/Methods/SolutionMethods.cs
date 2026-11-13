// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Projects;
using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.Rpc;
using NuGet.VisualStudioCode.Sessions;
using NuGet.VisualStudioCode.Solutions;

namespace NuGet.VisualStudioCode.Methods;

internal static class SolutionMethods {
  private readonly static Empty Done = new();

  public static void Register(RpcConnection connection, SessionManager sessions, ProjectEvaluator evaluator) {
    connection.OnRequest(
      MethodNames.SOLUTION_OPEN,
      ProtocolJsonContext.Default.SolutionOpenParams,
      ProtocolJsonContext.Default.SolutionOpenResult,
      async (parameters, ct) =>
      {
        var solution = await SolutionReader.ReadAsync(parameters.Path, parameters.Projects, ct).ConfigureAwait(false);
        var models = await evaluator.EvaluateAsync(solution, ct).ConfigureAwait(false);
        sessions.Replace(new Session(solution, models));
        return new SolutionOpenResult(solution.Path, KindName(solution.Kind),
          models.Select(model => model.Info).ToList());
      }
    );
    connection.OnRequest(MethodNames.SOLUTION_CLOSE, ProtocolJsonContext.Default.Empty,
      ProtocolJsonContext.Default.Empty, (_, _) =>
      {
        sessions.Close();
        return Task.FromResult(Done);
      }
    );
  }

  private static string KindName(SolutionKind kind)
    => kind switch {
      SolutionKind.Sln => "sln",
      SolutionKind.Slnx => "slnx",
      SolutionKind.Slnf => "slnf",
      var _ => "implicit"
    };
}
