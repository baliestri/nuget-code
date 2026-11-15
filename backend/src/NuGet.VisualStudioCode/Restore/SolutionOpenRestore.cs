// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Logging;
using NuGet.VisualStudioCode.Operations;
using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.Sessions;

namespace NuGet.VisualStudioCode.Restore;

/// <summary>
///   The restore that follows a solution being opened. It runs in the background, through the operation queue,
///   and tells the host how it went with <c>restore/didFinish</c>; opening the solution never waits for it.
/// </summary>
internal sealed class SolutionOpenRestore(
  SessionManager sessions,
  OperationQueue queue,
  RestoreService restore,
  SessionRefresher refresher,
  BackendOptions options,
  BackendLog log,
  Func<RestoreDidFinishParams, Task> notify
) {
  private const string REASON = "solutionOpen";

  public void Start() {
    if (options.RestoreOnOpen) {
      _ = RunAsync();
    }
  }

  private async Task RunAsync() {
    try {
      var result = await queue.RunAsync(RestoreAsync, CancellationToken.None).ConfigureAwait(false);
      if (result is not null) {
        await notify(new RestoreDidFinishParams(REASON, result)).ConfigureAwait(false);
      }
    }
    catch (OperationCanceledException) {
      // Another solution was opened before this restore got its turn.
    }
    catch (Exception exception) {
      log.Write(LogLevels.ERROR, LogContexts.BACKEND,
        $"The restore after opening the solution failed: {exception.Message}");
    }
  }

  private async Task<OperationResult?> RestoreAsync(CancellationToken ct) {
    var session = sessions.Current;
    if (session is null) {
      return null;
    }

    var target = new RestoreTarget(session.Solution, session.Projects, true, false);
    var result = await restore.RestoreAsync(target, null, ct).ConfigureAwait(false);
    refresher.Report(session.Projects.Select(project => project.AssetsPath).OfType<string>().ToList());
    return result;
  }
}
